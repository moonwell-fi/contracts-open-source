const hre = require('hardhat')
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
const {
  encodeParameters,
} = require('../../Utils/Ethereum');
import { call, send, mineBlockWithTimestamp, resetHardhatNetwork  } from "../../utils";
import { expect } from "chai";
import { solidity } from "ethereum-waffle";
import chai from "chai";
import { BigNumber } from "ethers";
chai.use(solidity);

const QUORUM = 300
const LOWER_QUORUM_CAP = 100
const UPPER_QUORUM_CAP = 500

describe('GovernorApollo#propose/5', () => {
  let gov: any
  let govToken: any
  let root: SignerWithAddress
  let acct: SignerWithAddress
  let accounts: Array<SignerWithAddress>

  before(async () => {
    [root, acct, ...accounts] = await hre.ethers.getSigners();

    // Deploy gov token
    const wellFactory = await hre.ethers.getContractFactory("Well");
    govToken = await wellFactory.deploy(await root.getAddress())

    // Deploy safety module
    const safetyModuleFactory = await hre.ethers.getContractFactory("StakedWell")
    const safetyModule = await hre.upgrades.deployProxy(
      safetyModuleFactory,
      [
        govToken.address, // Staked token
        govToken.address, // Reward token
        10,
        10,
        await root.getAddress(), // Unused in this test suite
        await root.getAddress(), // Unused in this test suite
        3600,
        hre.ethers.constants.AddressZero, // Governance, set to 0x0 for now, unused
      ]
    );
    const assetConfig = {
      emissionPerSecond: hre.ethers.utils.parseEther("12345678901234567890"),
      totalStaked: 0, // Genesis, 0 supply now
      underlyingAsset: safetyModule.address,
    }
    await safetyModule.connect(root).configureAssets([assetConfig]);

    // Deploy distributor
    const tokenSaleDistributorFactory = await hre.ethers.getContractFactory("TokenSaleDistributor");
    const tokenSaleDistributorProxyFactory = await hre.ethers.getContractFactory("TokenSaleDistributorProxy");
    const distributorProxy = await tokenSaleDistributorProxyFactory.deploy();
    const distributorImplementation = await tokenSaleDistributorFactory.deploy();
    await distributorProxy.setPendingImplementation(distributorImplementation.address);
    await (await distributorImplementation.becomeImplementation(distributorProxy.address)).wait();
    const distributor = tokenSaleDistributorFactory.attach(distributorProxy.address);

    const govFactory = await hre.ethers.getContractFactory("MoonwellGovernorApollo")
    gov = await govFactory.deploy(
      hre.ethers.constants.AddressZero,
      govToken.address,
      distributor.address,
      safetyModule.address,
      await root.getAddress(),
      await root.getAddress(),
      await root.getAddress(),
      0,
      QUORUM,
      LOWER_QUORUM_CAP,
      UPPER_QUORUM_CAP
    )    
  });

  let trivialProposal: any
  let targets: Array<string>
  let values: Array<string>
  let signatures: Array<string> 
  let callDatas: Array<string>
  let proposalSubmitTime: any
  let proposalId: number
  let delay: any
  let votingPeriod: any

  before(async () => {
    targets = [await root.getAddress()];
    values = ["0"];
    signatures = ["getBalanceOf(address)"];
    callDatas = [encodeParameters(['address'], [await acct.getAddress()])];
    await send(govToken, 'delegate', [await root.getAddress()]);
    
    const tx = await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"]);
    const blockNumber = tx.blockNumber
    const block = await hre.ethers.provider.getBlock(blockNumber)
    proposalSubmitTime = block.timestamp

    proposalId = await call(gov, 'latestProposalIds', [await root.getAddress()]);
    trivialProposal = await call(gov, "proposals", [proposalId]);

    delay = await call(gov, 'votingDelay')
    votingPeriod = await call(gov, 'votingPeriod')
  });

  it("Given the sender's GetPriorVotes for the immediately previous block is above the Proposal Threshold (e.g. 2%), the given proposal is added to all proposals, given the following settings", async () => {
    //test.todo('depends on get prior votes and delegation and voting');
  });

  describe("simple initialization", () => {
    it("ID is set to a globally unique identifier", async () => {
      expect(trivialProposal.id).to.be.equal(proposalId);
    });

    it("Proposer is set to the sender", async () => {
      expect(trivialProposal.proposer).to.be.equal(await root.getAddress());
    });

    it("Start block is set to the current block number plus vote delay", async () => {
      console.log('Actual: ' + trivialProposal.startTimestamp)
      expect(trivialProposal.startTimestamp).to.be.equal(Number.parseInt(proposalSubmitTime) + Number.parseInt(delay));
    });

    it("End block is set to the current block number plus the sum of vote delay and vote period", async () => {
      expect(trivialProposal.endTimestamp).to.be.equal(Number.parseInt(proposalSubmitTime) + Number.parseInt(delay) + Number.parseInt(votingPeriod));
    });

    it("ForVotes and AgainstVotes are initialized to zero", async () => {
      expect(trivialProposal.forVotes).to.be.equal("0");
      expect(trivialProposal.againstVotes).to.be.equal("0");
      expect(trivialProposal.abstainVotes).to.be.equal("0");
    });

    // xit("Voters is initialized to the empty set", async () => {
    //   test.todo('mmm probably nothing to prove here unless we add a counter or something');
    // });

    it("Executed and Canceled flags are initialized to false", async () => {
      expect(trivialProposal.canceled).to.be.equal(false);
      expect(trivialProposal.executed).to.be.equal(false);
    });

    it("ETA is initialized to zero", async () => {
      expect(trivialProposal.eta).to.be.equal("0");
    });

    it("Targets, Values, Signatures, Calldatas are set according to parameters", async () => {
      let dynamicFields = await call(gov, 'getActions', [trivialProposal.id]);

      expect(dynamicFields.targets).to.deep.equal(targets);
      // TODO(lunar-eng): Figure out what ethers is doing to our types here
      // expect(dynamicFields.values).to.deep.equal(values);
      expect(dynamicFields.signatures).to.deep.equal(signatures);
      expect(dynamicFields.calldatas).to.deep.equal(callDatas);
    });

    describe("This function must revert if", () => {
      it("the length of the values, signatures or calldatas arrays are not the same length,", async () => {
        await expect(
          call(gov, 'propose', [targets.concat(await root.getAddress()), values, signatures, callDatas, "do nothing"])
        ).to.be.revertedWith("GovernorApollo::propose: proposal function information arity mismatch");

        await expect(
          call(gov, 'propose', [targets, values.concat(values), signatures, callDatas, "do nothing"])
        ).to.be.revertedWith("GovernorApollo::propose: proposal function information arity mismatch");

        await expect(
          call(gov, 'propose', [targets, values, signatures.concat(signatures), callDatas, "do nothing"])
        ).to.be.revertedWith("GovernorApollo::propose: proposal function information arity mismatch");

        await expect(
          call(gov, 'propose', [targets, values, signatures, callDatas.concat(callDatas), "do nothing"])
        ).to.be.revertedWith("GovernorApollo::propose: proposal function information arity mismatch");
      });

      it("or if that length is zero or greater than Max Operations.", async () => {
        await expect(
          call(gov, 'propose', [[], [], [], [], "do nothing"])
        ).to.be.revertedWith("GovernorApollo::propose: must provide actions");
      });

      describe("Additionally, if there exists a pending or active proposal from the same proposer, we must revert.", () => {
        it("reverts with pending", async () => {
          await expect(
            call(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"])
          ).to.be.revertedWith("GovernorApollo::propose: one live proposal per proposer, found an already pending proposal");
        });

        it("reverts with active... and tests start block", async () => {
          await mineBlockWithTimestamp(trivialProposal.startTimestamp.add(1).toNumber())

          await expect(
            call(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"])
          ).to.be.revertedWith("GovernorApollo::propose: one live proposal per proposer, found an already active proposal");

          // There's only one proposal under test and we also should test that start block is set correctly. 
          // This test started the voting period, so we just tack this one on here, since otherwise we have random
          // race conditions or need a separate test suite.

          // Cast a vote
          const voteTx = await send(gov, 'castVote', [proposalId, 0])

          // Refresh proposal 
          trivialProposal = await call(gov, "proposals", [proposalId]);

          expect(voteTx.blockNumber - 1).to.be.equal(trivialProposal.startBlock)

        });
      });
    });

    it("This function returns the id of the newly created proposal. # proposalId(n) = succ(proposalId(n-1))", async () => {
      await send(govToken, 'transfer', [await accounts[2].getAddress(), BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))]);
      await send(govToken, 'delegate', [await accounts[2].getAddress()], { from: accounts[2] });

      await send(gov, 'propose', [targets, values, signatures, callDatas, "yoot"], { from: accounts[2]});
      const nextProposalId = await call(gov, 'latestProposalIds', [await accounts[2].getAddress()]);

      expect(+nextProposalId).to.be.equal(+trivialProposal.id + 1);
    });

    // TODO(lunar-eng): Enable when we test logs
    // it("emits log with id and description", async () => {
    //   await send(comp, 'transfer', [accounts[3], etherMantissa(400001)]);
    //   await send(comp, 'delegate', [accounts[3]], { from: accounts[3] });
    //   await mineBlock();
    //   let nextProposalId = await gov.methods['propose'](targets, values, signatures, callDatas, "yoot").call({ from: accounts[3] });

    //   expect(
    //     await send(gov, 'propose', [targets, values, signatures, callDatas, "second proposal"], { from: accounts[3] })
    //   ).toHaveLog("ProposalCreated", {
    //     id: nextProposalId,
    //     targets: targets,
    //     values: values,
    //     signatures: signatures,
    //     calldatas: callDatas,
    //     startBlock: 14,
    //     endBlock: 17294,
    //     description: "second proposal",
    //     proposer: accounts[3]
    //   });
    // });
  });
});