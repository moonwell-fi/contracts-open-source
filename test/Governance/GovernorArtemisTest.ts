import { BigNumber, Signer } from "ethers";
import { call, send, mineBlockWithTimestamp, resetHardhatNetwork  } from "../utils";
const { ethers } = require('hardhat')
const hre = require('hardhat')
import { expect } from "chai";
import { solidity } from "ethereum-waffle";
import chai from "chai";

chai.use(solidity);

const TIMELOCK_DELAY = 2 * 24 * 60 * 60 // 2 days
const GUARDIAN_SUNSET = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // ~1 year from now

// Voting Constants
const VOTE_YES = 0
const VOTE_NO = 1
const VOTE_ABSTAIN = 2

// Proposal States
const PROPOSAL_STATE_DEFEATED = 3
const PROPOSAL_STATE_SUCCEEDED = 4

// Helper function to formulate a number into calldata.
const numberToCalldata = (input: number): string => {
  return ethers.utils.hexZeroPad(BigNumber.from(input).toHexString(), 32) 
}

// Helper function to formulate an address into calldata. 
const addressToCallData = (input: string): string => {
  return `0x000000000000000000000000${input.slice(2)}`
}

describe('Moonwell Governor Artemis', () => {
  // Root account with initial admin
  let rootAccount: Signer

  // Roles in governance
  let breakGlassGuardian: Signer
  let governanceReturnGuardian: Signer
  let governanceReturnAddress: Signer

  // Users
  let alice: Signer
  let bob: Signer
  let charlie: Signer
  let diane: Signer

  // The timelock
  let timelock: any

  // The governor
  let governor: any

  // The governance token
  let govToken: any

  // A unitroller
  let unitroller: any

  // A safety module
  let safetyModule: any

  // A token sale distributor
  let distributor: any

  // current proposal ID
  let proposalID: number

  /**
   * Helper function to pass a proposal through governance
   * 
   * Assumptions:
   * - Root has enough tokens delegated to themselves to unilaterally pass a proposal.
   */
  const passProposal = async (targetAddress: string, signature: string, calldata: string) => {
    // Put up a proposal from Alice and increment proposalID
    await send(
      governor, 
      'propose',
      [[targetAddress], [0], [signature], [calldata], 'UNIT TEST'], 
      { from: alice }
    )
    proposalID += 1

    // Grab proposal data.
    let proposal = await governor.proposals(proposalID)

    // Delay until voting begins
    await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())

    // Vote Yes
    await send(governor, 'castVote', [proposalID, VOTE_YES], { from: alice})

    // Delay for the end of voting
    await mineBlockWithTimestamp(proposal.endTimestamp.toNumber())

    // Queue the proposal
    await send(governor, 'queue', [proposalID], {from: alice})

    // Refresh proposal, which now has an eta
    proposal = await governor.proposals(proposalID)
    
    // Delay for the timelock
    await mineBlockWithTimestamp(proposal.eta.toNumber())

    // Execute the proposal
    await send(governor, 'execute', [proposalID], {from: alice})
  }

  beforeEach(async () => {
    await resetHardhatNetwork();

    // Load roles from the network.
    [ rootAccount, breakGlassGuardian, governanceReturnGuardian, governanceReturnAddress, alice, bob, charlie, diane ] = await hre.ethers.getSigners();

    // Load contracts
    const timelockFactory = await hre.ethers.getContractFactory("Timelock")
    const governorFactory = await hre.ethers.getContractFactory("MoonwellGovernorArtemis")
    const govTokenFactory = await hre.ethers.getContractFactory("Well")
    const unitrollerFactory = await hre.ethers.getContractFactory("Unitroller")
    const safetyModuleFactory = await hre.ethers.getContractFactory("StakedWell")
    const tokenSaleDistributorFactory = await hre.ethers.getContractFactory("TokenSaleDistributor");
    const tokenSaleDistributorProxyFactory = await hre.ethers.getContractFactory("TokenSaleDistributorProxy");

    // Deploy test contracts
    timelock = await timelockFactory.deploy(await rootAccount.getAddress(), TIMELOCK_DELAY)

    govToken = await govTokenFactory.deploy(await rootAccount.getAddress())

    safetyModule = await hre.upgrades.deployProxy(
      safetyModuleFactory,
      [
        govToken.address, // Staked token
        govToken.address, // Reward token
        10,
        10,
        await rootAccount.getAddress(), // Unused in this test suite
        await rootAccount.getAddress(), // Unused in this test suite
        3600,
        ethers.constants.AddressZero, // Governance, set to 0x0 for now, unused
      ]
    );
    const assetConfig = {
      emissionPerSecond: ethers.utils.parseEther("12345678901234567890"),
      totalStaked: 0, // Genesis, 0 supply now
      underlyingAsset: safetyModule.address,
    }
    await safetyModule.connect(rootAccount).configureAssets([assetConfig]);

    const distributorProxy = await tokenSaleDistributorProxyFactory.deploy();
    const distributorImplementation = await tokenSaleDistributorFactory.deploy();
    await distributorProxy.setPendingImplementation(distributorImplementation.address);
    await (await distributorImplementation.becomeImplementation(distributorProxy.address)).wait();
    distributor = tokenSaleDistributorFactory.attach(distributorProxy.address);

    governor = await governorFactory.deploy(
      timelock.address,
      govToken.address,
      distributor.address,
      safetyModule.address,
      await breakGlassGuardian.getAddress(),
      await governanceReturnAddress.getAddress(),
      await governanceReturnGuardian.getAddress(),
      GUARDIAN_SUNSET
    )
    unitroller =await unitrollerFactory.deploy()

    // Wire Governor Alpha to administer the timelock
    await send(
      timelock, 
      "fastTrackExecuteTransaction", 
      [
        timelock.address, 
        0, 
        'setPendingAdmin(address)', 
        `0x000000000000000000000000${governor.address.slice(2)}`
      ]
    )
    await send(governor, '__acceptAdminOnTimelock', [],  {from: breakGlassGuardian})

    // Wire the unitroller to have the timelock as the admin.
    await send(unitroller, '_setPendingAdmin', [timelock.address])
    await send(governor, '__executeCompoundAcceptAdminOnContract', [[unitroller.address]], {from: breakGlassGuardian})    

    // Configure the distributor to use gov token and enable voting
    await distributor.setTokenAddress(govToken.address);
    await send(distributor, 'setVotingEnabled', [true])

    // Give alice a bunch of WELL and mark her as her own delegate. Alice will always propose things.
    await govToken.transfer(await alice.getAddress(), BigNumber.from("720000000000000000000000000"))
    await govToken.connect(alice).delegate(await alice.getAddress())

    // Give Bob, Charlie and Diane 100 fractions of a WELL each. They'll vote on things to test quorums.
    await govToken.transfer(await bob.getAddress(), BigNumber.from("100"))
    await govToken.connect(bob).delegate(await bob.getAddress())

    await govToken.transfer(await charlie.getAddress(), BigNumber.from("100"))
    await govToken.connect(charlie).delegate(await charlie.getAddress())

    await govToken.transfer(await diane.getAddress(), BigNumber.from("100"))
    await govToken.connect(diane).delegate(await diane.getAddress())

    // Reset proposal tracking
    proposalID = 0
  });

  describe('Governance Parameter Modification', () => {
    describe('setQuorumVotes', () => {
      it('fails when called externally', async () => {
        // GIVEN a governor
        // WHEN setQuorumVotes is called by an end user
        // THEN the call fails.
        await expect(send(governor, 'setQuorumVotes', [123])).to.be.reverted
      })

      it('updates when called from timelock', async () => {
        // GIVEN a governor
        // WHEN setQuorumVotes is called by the timelock
        const newQuorum = 123
        await passProposal(governor.address, 'setQuorumVotes(uint256)', numberToCalldata(newQuorum))

        // THEN quorumVotes is updated
        expect(await call(governor, 'quorumVotes')).to.equal(newQuorum)
      })
    })

    describe('setProposalThreshold', () => {
      it('fails when called externally', async () => {
        // GIVEN a governor
        // WHEN setProposalThreshold is called by an end user
        // THEN the call fails.
        await expect(send(governor, 'setProposalThreshold', [123])).to.be.reverted
      })

      it('updates when called from timelock', async () => {
        // GIVEN a governor
        // WHEN setProposalThreshold is called by the timelock
        const newProposalThreshold = 123
        await passProposal(governor.address, 'setProposalThreshold(uint256)', numberToCalldata(newProposalThreshold))

        // THEN proposalThreshold is updated
        expect(await call(governor, 'proposalThreshold')).to.equal(newProposalThreshold)
      })
    })

    describe('setProposalMaxOperations', () => {
      it('fails when called externally', async () => {
        // GIVEN a governor
        // WHEN setProposalMaxOperations is called by an end user
        // THEN the call fails.
        await expect(send(governor, 'setProposalMaxOperations', [123])).to.be.reverted
      })

      it('updates when called from timelock', async () => {
        // GIVEN a governor
        // WHEN setProposalMaxOperations is called by the timelock
        const newMaxOperations = 123
        await passProposal(governor.address, 'setProposalMaxOperations(uint256)', numberToCalldata(newMaxOperations))

        // THEN maxOperations is updated
        expect(await call(governor, 'proposalMaxOperations')).to.equal(newMaxOperations)
      })
    })

    describe('setVotingDelay', () => {
      it('fails when called externally', async () => {
        // GIVEN a governor
        // WHEN setVotingDelay is called by an end user
        // THEN the call fails.
        await expect(send(governor, 'setVotingDelay', [123])).to.be.reverted
      })

      it('updates when called from timelock', async () => {
        // GIVEN a governor
        // WHEN setVotingDelay is called by the timelock
        const newVotingDelay = 123
        await passProposal(governor.address, 'setVotingDelay(uint256)', numberToCalldata(newVotingDelay))

        // THEN votingDelay is updated
        expect(await call(governor, 'votingDelay')).to.equal(newVotingDelay)
      })
    })

    describe('setVotingPeriod', () => {
      it('fails when called externally', async () => {
        // GIVEN a governor
        // WHEN setVotingPeriod is called by an end user
        // THEN the call fails.
        await expect(send(governor, 'setVotingPeriod', [123])).to.be.reverted
      })

      it('updates when called from timelock', async () => {
        // GIVEN a governor
        // WHEN setVotingPeriod is called by the timelock
        const newVotingPeriod = 123
        await passProposal(governor.address, 'setVotingPeriod(uint256)', numberToCalldata(newVotingPeriod))

        // THEN votingPeriod is updated
        expect(await call(governor, 'votingPeriod')).to.equal(newVotingPeriod)
      })
    })
  })

  describe('Funds Rescuing', () => {
    describe('Governor', () => {
      it('can transfer tokens', async () => {
        // GIVEN that the governor has some tokens
        const tokenAmount = 100
        await send(govToken, 'transfer', [governor.address, tokenAmount], { from: bob })

        // Sanity check, bob has zero tokens and governor has 100
        expect(await call(govToken, 'balanceOf', [governor.address])).to.equal(100)
        expect(await call(govToken, 'balanceOf', [await bob.getAddress()])).to.equal(0)

        // WHEN a governance proposal is executed to transfer the tokens to Bob
        const calldata = `${addressToCallData(govToken.address)}${addressToCallData(await bob.getAddress()).slice(2)}`
        await passProposal(governor.address, 'sweepTokens(address,address)', calldata)

        // THEN the tokens are transfered
        expect(await call(govToken, 'balanceOf', [governor.address])).to.equal(0)
        expect(await call(govToken, 'balanceOf', [await bob.getAddress()])).to.equal(tokenAmount)
      })
    })

    describe('Timelock', () => {
      it('can transfer tokens', async () => {
        // GIVEN that the governor has some tokens
        const tokenAmount = 100
        await send(govToken, 'transfer', [timelock.address, tokenAmount], { from: bob})

        // Sanity check, bob has zero tokens and timelock has 100
        expect(await call(govToken, 'balanceOf', [timelock.address])).to.equal(100)
        expect(await call(govToken, 'balanceOf', [await bob.getAddress()])).to.equal(0)

        // WHEN a governance proposal is executed to transfer the tokens to Bob
        const calldata = `${addressToCallData(await bob.getAddress())}${numberToCalldata(tokenAmount).slice(2)}`
        await passProposal(govToken.address, 'transfer(address,uint256)', calldata)

        // THEN the tokens are transfered
        expect(await call(govToken, 'balanceOf', [timelock.address])).to.equal(0)
        expect(await call(govToken, 'balanceOf', [await bob.getAddress()])).to.equal(tokenAmount)
      })
    })
  })

  describe('Proposal Resolution', () => {
    it('quorum achieved without plurality', async () => {
      // GIVEN that quorum is 300, and Bob/Charlie/Diane each have 100 tokens
      await passProposal(governor.address, 'setQuorumVotes(uint256)', numberToCalldata(300))

      // AND there is a proposal on the governor
      await send(
        governor, 
        'propose',
        [[governor.address], [0], ['setQuorumVotes(uint256)'], [numberToCalldata(123)], 'UNIT TEST'], 
        { from: alice }
      )
      proposalID++      

      // WHEN quorum is achieved without plurality
      // Final vote count: Yes: 100, No: 200, Total Votes: 300
      let proposal = await governor.proposals(proposalID)
      await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())
        
      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: bob })
      await send(governor, 'castVote', [proposalID, VOTE_NO], { from: charlie })
      await send(governor, 'castVote', [proposalID, VOTE_NO], { from: diane })

      // AND voting is closed
      await mineBlockWithTimestamp(proposal.endTimestamp.toNumber())
      await ethers.provider.send("evm_mine", []); // Mine one more block after the voting end.

      // THEN the proposal state is defeated
      expect(await call(governor, 'state', [proposalID])).to.equal(PROPOSAL_STATE_DEFEATED)

      // AND the vote tallies are correct
      proposal = await governor.proposals(proposalID)
      expect(proposal.forVotes).to.equal(100)
      expect(proposal.againstVotes).to.equal(200)
      expect(proposal.abstainVotes).to.equal(0)
      expect(proposal.totalVotes).to.equal(300)
    })

    it('quorum achieved with plurality', async () => {
      // GIVEN that quorum is 300, and Bob/Charlie/Diane each have 100 tokens
      await passProposal(governor.address, 'setQuorumVotes(uint256)', numberToCalldata(300))

      // AND there is a proposal on the governor
      await send(
        governor, 
        'propose',
        [[governor.address], [0], ['setQuorumVotes(uint256)'], [numberToCalldata(123)], 'UNIT TEST'], 
        { from: alice }
      )
      proposalID++      

      // WHEN quorum and plurality are achieved
      // Final vote count: Yes: 200, No: 100, Total Votes: 300
      let proposal = await governor.proposals(proposalID)
      await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())
        
      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: bob })
      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: charlie })
      await send(governor, 'castVote', [proposalID, VOTE_NO], { from: diane })

      // AND voting is closed
      await mineBlockWithTimestamp(proposal.endTimestamp.toNumber())
      await ethers.provider.send("evm_mine", []); // Mine one more block after the voting end.

      // THEN the proposal state is succeeded
      expect(await call(governor, 'state', [proposalID])).to.equal(PROPOSAL_STATE_SUCCEEDED)

      // AND the vote tallies are correct
      proposal = await governor.proposals(proposalID)
      expect(proposal.forVotes).to.equal(200)
      expect(proposal.againstVotes).to.equal(100)
      expect(proposal.abstainVotes).to.equal(0)
      expect(proposal.totalVotes).to.equal(300)
    })

    it('quorum not achieved and plurality not achieved', async () => {
      // GIVEN that quorum is 300, and Bob/Charlie/Diane each have 100 tokens
      await passProposal(governor.address, 'setQuorumVotes(uint256)', numberToCalldata(300))

      // AND there is a proposal on the governor
      await send(
        governor, 
        'propose',
        [[governor.address], [0], ['setQuorumVotes(uint256)'], [numberToCalldata(123)], 'UNIT TEST'], 
        { from: alice }
      )
      proposalID++      

      // WHEN quorum and plurality are not achieved
      // Final vote count: Yes: 0, No: 200, Total Votes: 200
      let proposal = await governor.proposals(proposalID)
      await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())
        
      await send(governor, 'castVote', [proposalID, VOTE_NO], { from: bob })
      await send(governor, 'castVote', [proposalID, VOTE_NO], { from: charlie })

      // AND voting is closed
      await mineBlockWithTimestamp(proposal.endTimestamp.toNumber())
      await ethers.provider.send("evm_mine", []); // Mine one more block after the voting end.

      // THEN the proposal state is defeated
      expect(await call(governor, 'state', [proposalID])).to.equal(PROPOSAL_STATE_DEFEATED)

      // AND the vote tallies are correct
      proposal = await governor.proposals(proposalID)
      expect(proposal.forVotes).to.equal(0)
      expect(proposal.againstVotes).to.equal(200)
      expect(proposal.abstainVotes).to.equal(0)
      expect(proposal.totalVotes).to.equal(200)
    })

    it('quorum not achieved and plurality achieved', async () => {
      // GIVEN that quorum is 300, and Bob/Charlie/Diane each have 100 tokens
      await passProposal(governor.address, 'setQuorumVotes(uint256)', numberToCalldata(300))

      // AND there is a proposal on the governor
      await send(
        governor, 
        'propose',
        [[governor.address], [0], ['setQuorumVotes(uint256)'], [numberToCalldata(123)], 'UNIT TEST'], 
        { from: alice }
      )
      proposalID++      

      // WHEN quorum and plurality are achieved
      // Final vote count: Yes: 200, No: 0, Total Votes: 200
      let proposal = await governor.proposals(proposalID)
      await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())
        
      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: bob })
      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: charlie })

      // AND voting is closed
      await mineBlockWithTimestamp(proposal.endTimestamp.toNumber())
      await ethers.provider.send("evm_mine", []); // Mine one more block after the voting end.

      // THEN the proposal state is defeated
      expect(await call(governor, 'state', [proposalID])).to.equal(PROPOSAL_STATE_DEFEATED)

      // AND the vote tallies are correct
      proposal = await governor.proposals(proposalID)
      expect(proposal.forVotes).to.equal(200)
      expect(proposal.againstVotes).to.equal(0)
      expect(proposal.abstainVotes).to.equal(0)
      expect(proposal.totalVotes).to.equal(200)
    })

    it('Abstain votes count towards quorum', async () => {
      // GIVEN that quorum is 300, and Bob/Charlie/Diane each have 100 tokens
      await passProposal(governor.address, 'setQuorumVotes(uint256)', numberToCalldata(300))

      // AND there is a proposal on the governor
      await send(
        governor, 
        'propose',
        [[governor.address], [0], ['setQuorumVotes(uint256)'], [numberToCalldata(123)], 'UNIT TEST'], 
        { from: alice }
      )
      proposalID++      

      // WHEN plurality is achieved, and quorum is achieved with the help of abstain votes
      // Final vote count: Yes: 200, No: 0, Abstain: 100 Total Votes: 300
      let proposal = await governor.proposals(proposalID)
      await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())
        
      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: bob })
      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: charlie })
      await send(governor, 'castVote', [proposalID, VOTE_ABSTAIN], { from: diane })

      // AND voting is closed
      await mineBlockWithTimestamp(proposal.endTimestamp.toNumber())
      await ethers.provider.send("evm_mine", []); // Mine one more block after the voting end.

      // THEN the proposal state is succeeded
      expect(await call(governor, 'state', [proposalID])).to.equal(PROPOSAL_STATE_SUCCEEDED)

      // AND the vote tallies are correct
      proposal = await governor.proposals(proposalID)
      expect(proposal.forVotes).to.equal(200)
      expect(proposal.againstVotes).to.equal(0)
      expect(proposal.abstainVotes).to.equal(100)
      expect(proposal.totalVotes).to.equal(300)
    })
  })

  describe('Voting Power', () => {
    it('Calculates voting power correctly for one user', async () => {
      // GIVEN bob has 50 tokens in the safety module
      const safetyModuleTokens = 50
      await send(govToken, 'approve', [safetyModule.address, safetyModuleTokens], { from: bob })
      await send(safetyModule, 'stake', [await bob.getAddress(), safetyModuleTokens], { from: bob })

      // AND bob has 10 tokens in the vesting contract, delegated to himself
      const vestingContractAmount = 10
      await send(distributor, 'setAllocations', [[await bob.getAddress()], [true], [Math.floor(Date.now() / 1000)], [365 * 24 * 60 * 60], [0], [0], [vestingContractAmount]])
      await send(distributor, 'delegate', [await bob.getAddress()], { from: bob })

      // AND there is a proposal up for vote
      await send(
        governor, 
        'propose',
        [[governor.address], [0], ['setQuorumVotes(uint256)'], [numberToCalldata(123)], 'UNIT TEST'], 
        { from: alice }
      )
      proposalID++      

      // WHEN bob votes on the proposal
      let proposal = await governor.proposals(proposalID)
      await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())

      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: bob })

      // THEN bob's votes are tabulated correctly
      // expected = (starting - staked in safety module) + (staked in safety module) + vesting contract
      //          = (100 - 50) + 50 + 10
      //          = 110
      proposal = await governor.proposals(proposalID)
      expect(proposal.forVotes).to.equal(110)
    })

    it('Calculates voting power correctly for two users', async () => {
      // GIVEN bob has 50 tokens in the safety module
      const safetyModuleTokens = 50
      await send(govToken, 'approve', [safetyModule.address, safetyModuleTokens], { from: bob })
      await send(safetyModule, 'stake', [await bob.getAddress(), safetyModuleTokens], { from: bob })

      // AND bob has 10 tokens in the vesting contract, delegated to himself
      const vestingContractAmount = 10
      await send(distributor, 'setAllocations', [[await bob.getAddress()], [true], [Math.floor(Date.now() / 1000)], [365 * 24 * 60 * 60], [0], [0], [vestingContractAmount]])
      await send(distributor, 'delegate', [await bob.getAddress()], { from: bob })

      // AND charlie puts 20 tokens in the safety module some time later.
      await mineBlockWithTimestamp(Date.now() + 600) 
      await send(govToken, 'approve', [safetyModule.address, 20], { from: charlie })
      await send(safetyModule, 'stake', [await charlie.getAddress(), 20], { from: charlie })

      // AND charlie has 30 tokens in the vesting contract, delegated to himself
      await send(distributor, 'setAllocations', [[await charlie.getAddress()], [true], [Math.floor(Date.now() / 1000)], [365 * 24 * 60 * 60], [0], [0], [40]])
      await send(distributor, 'delegate', [await charlie.getAddress()], { from: charlie })

      // AND there is a proposal up for vote
      await send(
        governor, 
        'propose',
        [[governor.address], [0], ['setQuorumVotes(uint256)'], [numberToCalldata(123)], 'UNIT TEST'], 
        { from: alice }
      )
      proposalID++      

      // WHEN bob votes on the proposal
      let proposal = await governor.proposals(proposalID)
      await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())

      await send(governor, 'castVote', [proposalID, VOTE_YES], { from: bob })

      // AND charlie votes on the proposal
      await send(governor, 'castVote', [proposalID, VOTE_ABSTAIN], { from: charlie })

      // THEN bob's votes are tabulated correctly
      // expected = (starting - staked in safety module) + (staked in safety module) + vesting contract
      //          = (100 - 50) + 50 + 10
      //          = 110
      proposal = await governor.proposals(proposalID)
      expect(proposal.forVotes).to.equal(110)

      // AND charlie's votes are tabulated correctly
      // expected = (starting - staked in safety module) + (staked in safety module) + vesting contract
      //          = (100 - 20) + 20 + 40
      //          = 140
      expect(proposal.abstainVotes).to.equal(140)

      // AND total votes reflects both of their balances
      expect(proposal.totalVotes).to.equal(110 + 140)
    })
  })

  describe('Governance Guardians', () => {
    describe('Guardian Sunset', () => {
      it('sunsetting fails when not performed by timelock', async () => {
        // GIVEN it is after the governance guardian sunset
        await mineBlockWithTimestamp(GUARDIAN_SUNSET)
        await ethers.provider.send("evm_mine", []); // Mine one more block after the sunset.

        // WHEN __removeGuardians is called by an external party
        // THEN the call is reverted
        await expect(send(governor, '__removeGuardians', [])).to.be.revertedWith("GovernorArtemis::__removeGuardians: sender must be the timelock")
      })

      it('sunsetting succeeds via proposal after sunset', async () => {
        // GIVEN it is after the governance guardian sunset
        await mineBlockWithTimestamp(GUARDIAN_SUNSET)
        await ethers.provider.send("evm_mine", []); // Mine one more block after the sunset.

        // WHEN __removeGuardians is called via governance
        await passProposal(governor.address, '__removeGuardians()', '0x')

        // THEN the guardians are zero'ed
        expect(await call(governor, 'breakGlassGuardian')).to.equal(ethers.constants.AddressZero)
        expect(await call(governor, 'governanceReturnGuardian')).to.equal(ethers.constants.AddressZero)
      })

      it('sunsetting fails via proposal before sunset', async () => {
        // GIVEN the current time is well before the guardian sunset

        // WHEN a proposal is made to sunset the guardians before the sunset period
        // Put up a proposal from Alice and increment proposalID
        await send(
          governor, 
          'propose',
          [[governor.address], [0], ['__removeGuardians()'], ['0x'], 'UNIT TEST'], 
          { from: alice }
        )
        proposalID += 1
    
        // Grab proposal data.
        let proposal = await governor.proposals(proposalID)
    
        // Delay until voting begins
        await mineBlockWithTimestamp(proposal.startTimestamp.toNumber())
    
        // Vote Yes
        await send(governor, 'castVote', [proposalID, VOTE_YES], { from: alice})
    
        // Delay for the end of voting
        await mineBlockWithTimestamp(proposal.endTimestamp.toNumber())
    
        // Queue the proposal
        await send(governor, 'queue', [proposalID], {from: alice})
    
        // Refresh proposal, which now has an eta
        proposal = await governor.proposals(proposalID)
        
        // Delay for the timelock
        await mineBlockWithTimestamp(proposal.eta.toNumber())
    
        // WHEN it is executed
        // THEN the call reverts
        await expect(send(governor, 'execute', [proposalID])).to.be.reverted
      })
    })

    describe('Governance Return Guardian', () => {
      it('governance return address cannot be rotated externally', async () => {
        // WHEN __setGovernanceReturnAddress is called by an external party
        // THEN the call is reverted
        await expect(send(governor, '__setGovernanceReturnAddress', [await bob.getAddress()])).to.be.revertedWith("GovernorArtemis::__setGovernanceReturnAddress: sender must be gov return guardian")
      })

      it('governance return guardian can rotate address', async () => {
        // WHEN the governance return guardian changes the return address
        await send(governor, '__setGovernanceReturnAddress', [await bob.getAddress()], { from: governanceReturnGuardian })

        // THEN the address rotation is successful
        expect(await call(governor, 'governanceReturnAddress')).to.equal(await bob.getAddress())
      })
    })

    describe('Governance Return Guardian', () => {
      it('governance return address cannot be rotated externally', async () => {
        // WHEN __setGovernanceReturnAddress is called by an external party
        // THEN the call is reverted
        await expect(send(governor, '__setGovernanceReturnAddress', [await bob.getAddress()])).to.be.revertedWith("GovernorArtemis::__setGovernanceReturnAddress: sender must be gov return guardian")
      })

      it('governance return guardian can rotate address', async () => {
        // WHEN the governance return guardian changes the return address
        await send(governor, '__setGovernanceReturnAddress', [await bob.getAddress()], { from: governanceReturnGuardian })

        // THEN the address rotation is successful
        expect(await call(governor, 'governanceReturnAddress')).to.equal(await bob.getAddress())
      })
    })
  })

  describe('Break Glass Guardian', () => {
    it('break glass guardian can rotate itself', async () => {
      // WHEN the break glass guardian requests to rotate itself
      await send(governor, 'setBreakGlassGuardian', [await bob.getAddress()], { from: breakGlassGuardian })

      // THEN the break glass guardian is rotated
      expect(await call(governor, 'breakGlassGuardian')).to.equal(await bob.getAddress())
    })

    it('break glass guardian rotations fails if called externally', async () => {
      // WHEN an external party requests to rotate the break glass guardian
      await expect(send(governor, 'setBreakGlassGuardian', [await bob.getAddress()])).to.be.revertedWith("only break glass guardian")
    })

    it('break glass guardian can break glass', async () => {
      // GIVEN the unitroller is admin'ed by the timelock and has no pending admin
      expect(await call(unitroller, 'admin')).to.be.equal(timelock.address)
      expect(await call(unitroller, 'pendingAdmin')).to.be.equal(ethers.constants.AddressZero)

      // WHEN the break glass guardian breaks glass
      await send(governor, '__executeBreakGlassOnCompound', [[unitroller.address]], { from: breakGlassGuardian})

      // THEN the unitroller sets the pending admin to the governance return address
      expect(await call(unitroller, 'admin')).to.equal(timelock.address)      
      expect(await call(unitroller, 'pendingAdmin')).to.equal(await governanceReturnAddress.getAddress())      
    })

    it('break glass fails when called externally', async () => {
      // WHEN break glass is called by an external party
      // THEN the call reverts
      await expect(send(governor, '__executeBreakGlassOnCompound', [[unitroller.address]])).to.be.revertedWith("GovernorArtemis::__breakglass: sender must be bg guardian")  
    })
  })
})

