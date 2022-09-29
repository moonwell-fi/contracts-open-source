import { BigNumber, Signer } from "ethers";
import { call, send, mineBlockWithTimestamp, resetHardhatNetwork } from "../../utils";
const { ethers } = require('hardhat')
const hre = require('hardhat')
import { expect } from "chai";
import { solidity } from "ethereum-waffle";
import chai from "chai";

chai.use(solidity);

const TIMELOCK_DELAY = 2 * 24 * 60 * 60 // 2 days
const GUARDIAN_SUNSET = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // ~1 year from now

// Proposal States
const PROPOSAL_STATE_PENDING = 0
const PROPOSAL_STATE_ACTIVE = 1
const PROPOSAL_STATE_CANCELLED = 2
const PROPOSAL_STATE_DEFEATED = 3
const PROPOSAL_STATE_SUCCEEDED = 4
const PROPOSAL_STATE_EXECUTED = 7

const QUORUM = 300

const TWENTY_FOUR_HOURS_AGO = Math.floor(Date.now() / 1000) - (24 * 60 * 60)
const EIGHT_HOURS_AGO = Math.floor(Date.now() / 1000) - (8 * 60 * 60)
const ONE_HOUR_AGO = Math.floor(Date.now() / 1000) - (1 * 60 * 60)
const ONE_HOUR_AHEAD = Math.floor(Date.now() / 1000) + (1 * 60 * 60)
const TOMORROW = Math.floor(Date.now() / 1000) + (24 * 60 * 60)

// Helper function to formulate a number into calldata.
const numberToCalldata = (input: number): string => {
  return ethers.utils.hexZeroPad(BigNumber.from(input).toHexString(), 32)
}

describe('Quorum Adjustments', () => {
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

  describe('Floating Quorum', () => {
    describe('Quorum Adjustments', () => {
      // Generous quorum caps for quorum adjustment tests.
      const LOWER_QUORUM_CAP = 100
      const UPPER_QUORUM_CAP = 500

      beforeEach(async () => {
        await resetHardhatNetwork();

        // Load roles from the network.
        [rootAccount, breakGlassGuardian, governanceReturnGuardian, governanceReturnAddress, alice, bob, charlie, diane] = await hre.ethers.getSigners();

        // Load contracts
        const timelockFactory = await hre.ethers.getContractFactory("Timelock")
        const governorFactory = await hre.ethers.getContractFactory("GovernorApolloTestHarness")
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
          GUARDIAN_SUNSET,
          QUORUM,
          LOWER_QUORUM_CAP,
          UPPER_QUORUM_CAP
        )
        unitroller = await unitrollerFactory.deploy()

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
        await send(governor, '__acceptAdminOnTimelock', [], { from: breakGlassGuardian })

        // Wire the unitroller to have the timelock as the admin.
        await send(unitroller, '_setPendingAdmin', [timelock.address])
        await send(governor, '__executeCompoundAcceptAdminOnContract', [[unitroller.address]], { from: breakGlassGuardian })

        // Configure the distributor to use gov token and enable voting
        await distributor.setTokenAddress(govToken.address);
        await send(distributor, 'setVotingEnabled', [true])

        // Give alice a bunch of WELL and mark her as her own delegate. Alice will always propose things.
        await govToken.transfer(await alice.getAddress(), BigNumber.from("720000000000000000000000000"))
        await govToken.connect(alice).delegate(await alice.getAddress())

        // Give Bob, Charlie and Diane 100 fractions of a WELL each. They'll vote on things to test quorums.
        await govToken.transfer(await bob.getAddress(), BigNumber.from("720000000000000000000000000"))
        await govToken.connect(bob).delegate(await bob.getAddress())

        await govToken.transfer(await charlie.getAddress(), BigNumber.from("100"))
        await govToken.connect(charlie).delegate(await charlie.getAddress())

        await govToken.transfer(await diane.getAddress(), BigNumber.from("100"))
        await govToken.connect(diane).delegate(await diane.getAddress())

        // Reset proposal tracking
        proposalID = 0
      });

      it('Adjusts quorum upwards', async () => {
        // GIVEN a proposal that passed with 400 votes
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            400,
            0,
            0,
            false,
            true,
            QUORUM,
            false
          ],
        )
        proposalID++
        const executedProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [executedProposalID])).to.equal(PROPOSAL_STATE_EXECUTED)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is adjusted upwards.
        // Expected quorum = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 300) + (.2 * 400) = 240 + 80 = 320
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(320)

        // AND the initial proposal is marked as being counted towards quorum.
        const executedProposal = await call(governor, 'proposals', [executedProposalID])
        expect(executedProposal.quorumAdjusted).to.be.true
      })

      it('Adjusts quorum downwards', async () => {
        // GIVEN a proposal that failed with 200 votes
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            200,
            0,
            0,
            false,
            true,
            QUORUM,
            false
          ],
        )
        proposalID++
        const failedProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [failedProposalID])).to.equal(PROPOSAL_STATE_DEFEATED)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is adjusted upwards.
        // Expected quorum = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 300) + (.2 * 200) = 240 + 40 = 280
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(280)

        // AND the initial proposal is marked as being counted towards quorum.
        const executedProposal = await call(governor, 'proposals', [failedProposalID])
        expect(executedProposal.quorumAdjusted).to.be.true
      })

      it('Ignores cancelled proposals in quorum adjustments', async () => {
        // GIVEN a proposal that passed with 400 votes, but was cancelled
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            400,
            0,
            0,
            true,
            false,
            QUORUM,
            false
          ],
        )
        proposalID++
        const cancelledProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [cancelledProposalID])).to.equal(PROPOSAL_STATE_CANCELLED)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is not adjusted
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(QUORUM)

        // AND the initial proposal is marked as being counted towards quorum.
        const executedProposal = await call(governor, 'proposals', [cancelledProposalID])
        expect(executedProposal.quorumAdjusted).to.be.true
      })

      it('Does not adjust quorum for proposals that are active', async () => {
        // GIVEN a proposal that is active with 400 votes
        await send(
          governor,
          'addProposal',
          [
            0,
            TWENTY_FOUR_HOURS_AGO,
            TOMORROW,
            0,
            400,
            0,
            0,
            false,
            false,
            QUORUM,
            false
          ],
        )
        proposalID++
        const activeProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [activeProposalID])).to.equal(PROPOSAL_STATE_ACTIVE)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is not adjusted
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(QUORUM)

        // AND the initial proposal is not marked as being counted towards quorum.
        const executedProposal = await call(governor, 'proposals', [activeProposalID])
        expect(executedProposal.quorumAdjusted).to.be.false
      })

      it('Does not adjust quorum for proposals that are pending', async () => {
        // GIVEN a proposal that is active with 400 votes
        await send(
          governor,
          'addProposal',
          [
            0,
            TOMORROW,
            TOMORROW,
            0,
            0,
            0,
            0,
            false,
            false,
            QUORUM,
            false
          ],
        )
        proposalID++
        const pendingProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [pendingProposalID])).to.equal(PROPOSAL_STATE_PENDING)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is not adjusted
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(QUORUM)

        // AND the initial proposal is not marked as being counted towards quorum.
        const executedProposal = await call(governor, 'proposals', [pendingProposalID])
        expect(executedProposal.quorumAdjusted).to.be.false
      })

      it('Skips over active proposals when calculating quorum, when active proposals are second', async () => {
        // GIVEN a proposal that is executed with 400 votes
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            400,
            0,
            0,
            false,
            true,
            QUORUM,
            false
          ],
        )
        proposalID++
        const executedProposalID = proposalID

        // AND a proposal that is active with 500 votes
        await send(
          governor,
          'addProposal',
          [
            0,
            TWENTY_FOUR_HOURS_AGO,
            ONE_HOUR_AHEAD,
            0,
            500,
            0,
            0,
            false,
            false,
            QUORUM,
            false
          ],
        )
        proposalID++
        const activeProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [executedProposalID])).to.equal(PROPOSAL_STATE_EXECUTED)
        expect(await call(governor, 'state', [activeProposalID])).to.equal(PROPOSAL_STATE_ACTIVE)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is adjusted upwards.
        // Expected quorum = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 300) + (.2 * 400) = 240 + 80 = 320
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(320)

        // AND executed proposal is marked as quorum adjusted
        const executedProposal = await call(governor, 'proposals', [executedProposalID])
        expect(executedProposal.quorumAdjusted).to.be.true

        // AND the active proposal is not marked as quorum adjusted.
        const activeProposal = await call(governor, 'proposals', [activeProposalID])
        expect(activeProposal.quorumAdjusted).to.be.false

        // AND the high water mark is adjusted correctly
        expect(await call(governor, 'lastQuorumAdjustment', [])).to.equal(executedProposalID)

        // WHEN the active proposal is reaches a deterministic state.
        await mineBlockWithTimestamp(activeProposal.endTimestamp.toNumber() + 1)

        // Sanity check state
        expect(await call(governor, 'state', [activeProposalID])).to.equal(PROPOSAL_STATE_SUCCEEDED)
        expect(await call(governor, 'state', [newProposalID])).to.equal(PROPOSAL_STATE_ACTIVE)

        // AND a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: bob })
        proposalID++
        const secondNewProposalID = proposalID

        // THEN quorum is adjusted upwards.
        // Expected quorum = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 320) + (.2 * 500) = 256 + 100 = 356
        const secondProposal = await call(governor, 'proposals', [secondNewProposalID])
        expect(secondProposal.quorum).to.equal(356)

        // AND previously active proposal is marked as quorum adjusted
        const previouslyActiveProposal = await call(governor, 'proposals', [activeProposalID])
        expect(previouslyActiveProposal.quorumAdjusted).to.be.true

        // AND the high water mark is adjusted correctly
        expect(await call(governor, 'lastQuorumAdjustment', [])).to.equal(activeProposalID)
      })

      it('Skips over active proposals when calculating quorum, when active proposals are first', async () => {
        // GIVEN a proposal that is active with 500 votes
        await send(
          governor,
          'addProposal',
          [
            0,
            TWENTY_FOUR_HOURS_AGO,
            ONE_HOUR_AHEAD,
            0,
            500,
            0,
            0,
            false,
            false,
            QUORUM,
            false
          ],
        )
        proposalID++
        const activeProposalID = proposalID

        // AND a proposal that is executed with 400 votes.
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            400,
            0,
            0,
            false,
            true,
            QUORUM,
            false
          ],
        )
        proposalID++
        const executedProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [executedProposalID])).to.equal(PROPOSAL_STATE_EXECUTED)
        expect(await call(governor, 'state', [activeProposalID])).to.equal(PROPOSAL_STATE_ACTIVE)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is adjusted upwards.
        // Expected quorum = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 300) + (.2 * 400) = 240 + 80 = 320
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(320)

        // AND executed proposal is marked as quorum adjusted
        const executedProposal = await call(governor, 'proposals', [executedProposalID])
        expect(executedProposal.quorumAdjusted).to.be.true

        // AND the active proposal is not marked as quorum adjusted.
        const activeProposal = await call(governor, 'proposals', [activeProposalID])
        expect(activeProposal.quorumAdjusted).to.be.false

        // AND the high water mark is adjusted correctly
        expect(await call(governor, 'lastQuorumAdjustment', [])).to.equal(0)

        // WHEN the active proposal is reaches a deterministic state.
        await mineBlockWithTimestamp(activeProposal.endTimestamp.toNumber() + 1)

        // Sanity check state
        expect(await call(governor, 'state', [activeProposalID])).to.equal(PROPOSAL_STATE_SUCCEEDED)
        expect(await call(governor, 'state', [newProposalID])).to.equal(PROPOSAL_STATE_ACTIVE)

        // AND a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: bob })
        proposalID++
        const secondNewProposalID = proposalID

        // THEN quorum is adjusted upwards.
        // Expected quorum = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 320) + (.2 * 500) = 256 + 100 = 356
        const secondProposal = await call(governor, 'proposals', [secondNewProposalID])
        expect(secondProposal.quorum).to.equal(356)

        // AND previously active proposal is marked as quorum adjusted
        const previouslyActiveProposal = await call(governor, 'proposals', [activeProposalID])
        expect(previouslyActiveProposal.quorumAdjusted).to.be.true

        // AND the high water mark is adjusted correctly
        expect(await call(governor, 'lastQuorumAdjustment', [])).to.equal(executedProposalID)
      })

      it('Calculates the result of two quorum adjustments correctly', async () => {
        // GIVEN a proposal that is executed with 500 votes
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            400,
            0,
            0,
            false,
            true,
            QUORUM,
            false
          ],
        )
        proposalID++
        const firstExecutedProposalID = proposalID

        // AND a proposal that is executed with 400 votes.
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            500,
            0,
            0,
            false,
            true,
            QUORUM,
            false
          ],
        )
        proposalID++
        const secondExecutedProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [secondExecutedProposalID])).to.equal(PROPOSAL_STATE_EXECUTED)
        expect(await call(governor, 'state', [firstExecutedProposalID])).to.equal(PROPOSAL_STATE_EXECUTED)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is adjusted upwards.
        // Expected quorum after prop 1 = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 300) + (.2 * 400) = 240 + 80 = 320
        // Expected quorum after prop 2 = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 320) + (.2 * 500) = 256 + 100 = 356
        const secondProposal = await call(governor, 'proposals', [newProposalID])
        expect(secondProposal.quorum).to.equal(356)

        // AND previously executed proposals are marked as quorum adjusted
        const firstExecutedProposal = await call(governor, 'proposals', [firstExecutedProposalID])
        expect(firstExecutedProposal.quorumAdjusted).to.be.true

        const secondExecutedProposal = await call(governor, 'proposals', [secondExecutedProposalID])
        expect(secondExecutedProposal.quorumAdjusted).to.be.true

        // AND the high water mark is adjusted correctly
        expect(await call(governor, 'lastQuorumAdjustment', [])).to.equal(secondExecutedProposalID)
      })
    })

    describe('Quorum Caps', () => {
      // Tightly cap the quorum around caps
      const LOWER_QUORUM_CAP = QUORUM - 1
      const UPPER_QUORUM_CAP = QUORUM + 1

      beforeEach(async () => {
        await resetHardhatNetwork();

        // Load roles from the network.
        [rootAccount, breakGlassGuardian, governanceReturnGuardian, governanceReturnAddress, alice, bob, charlie, diane] = await hre.ethers.getSigners();

        // Load contracts
        const timelockFactory = await hre.ethers.getContractFactory("Timelock")
        const governorFactory = await hre.ethers.getContractFactory("GovernorApolloTestHarness")
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
          GUARDIAN_SUNSET,
          QUORUM,
          LOWER_QUORUM_CAP,
          UPPER_QUORUM_CAP
        )

        unitroller = await unitrollerFactory.deploy()

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
        await send(governor, '__acceptAdminOnTimelock', [], { from: breakGlassGuardian })

        // Wire the unitroller to have the timelock as the admin.
        await send(unitroller, '_setPendingAdmin', [timelock.address])
        await send(governor, '__executeCompoundAcceptAdminOnContract', [[unitroller.address]], { from: breakGlassGuardian })

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

      it('Bounds to the upper quorum cap', async () => {
        // GIVEN a proposal that passed with 400 votes
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            400,
            0,
            0,
            false,
            true,
            QUORUM,
            false
          ],
        )
        proposalID++
        const executedProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [proposalID])).to.equal(PROPOSAL_STATE_EXECUTED)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is bound by the upper cap.
        // Expected quorum = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 300) + (.2 * 400) = 240 + 80 = 320
        // Quorum cap = 301 < 320 => expect 301
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(UPPER_QUORUM_CAP)

        // AND the initial proposal is marked as being counted towards quorum.
        const executedProposal = await call(governor, 'proposals', [executedProposalID])
        expect(executedProposal.quorumAdjusted).to.be.true
      })

      it('Bounds to the lower quorum cap', async () => {
        // GIVEN a proposal that failed with 200 votes
        await send(
          governor,
          'addProposal',
          [
            ONE_HOUR_AGO,
            TWENTY_FOUR_HOURS_AGO,
            EIGHT_HOURS_AGO,
            0,
            200,
            0,
            0,
            false,
            true,
            QUORUM,
            false
          ],
        )
        proposalID++
        const failedProposalID = proposalID

        // Sanity check state
        expect(await call(governor, 'state', [proposalID])).to.equal(PROPOSAL_STATE_DEFEATED)

        // WHEN a new proposal is created.
        await send(governor, 'propose', [[governor.address], [0], ['setProposalThreshold(uint256)'], [numberToCalldata(100)], "UNIT TEST"], { from: alice })
        proposalID++
        const newProposalID = proposalID

        // THEN quorum is bound by the lower cap.
        // Expected quorum = (.8 * oldQuorum) + (.2 * lastProposal) = (.8 * 300) + (.2 * 40) = 240 + 40 = 280
        // Quorum cap = 280 < 299 => expect 299
        const newProposal = await call(governor, 'proposals', [newProposalID])
        expect(newProposal.quorum).to.equal(LOWER_QUORUM_CAP)

        // AND the initial proposal is marked as being counted towards quorum.
        const executedProposal = await call(governor, 'proposals', [failedProposalID])
        expect(executedProposal.quorumAdjusted).to.be.true
      })
    })
  })
})
