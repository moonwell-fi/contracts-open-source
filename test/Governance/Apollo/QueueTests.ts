const hre = require('hardhat')
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
const {
  encodeParameters,
  etherUnsigned,
  freezeTime,
  keccak256
} = require('../../Utils/Ethereum');
import { call, send, mineBlockWithTimestamp, resetHardhatNetwork  } from "../../utils";
import { expect } from "chai";
import { solidity } from "ethereum-waffle";
import chai from "chai";
import { BigNumber } from "ethers";

// Voting Constants
const VOTE_YES = 0
const VOTE_NO = 1
const VOTE_ABSTAIN = 2

// State constants
const StatePending = 0
const StateActive = 1
const StateCanceled = 2
const StateDefeated = 3
const StateSucceeded = 4
const StateQueued = 5
const StateExpired = 6
const StateExecuted = 7

const QUORUM = 300
const LOWER_QUORUM_CAP = 100
const UPPER_QUORUM_CAP = 500

async function enfranchise(govToken: any, actor: any, amount: number) {
  await send(govToken, 'transfer', [await actor.getAddress(), BigNumber.from(amount).mul(BigNumber.from(10).pow(18))]);
  await send(govToken, 'delegate', [await actor.getAddress()], { from: actor });
}

describe('GovernorApollo#queue/1', () => {
  let root: SignerWithAddress
  let a1: SignerWithAddress
  let a2: SignerWithAddress 
  let accounts: Array<SignerWithAddress>

  before(async () => {
    [root, a1, a2, ...accounts] = await hre.ethers.getSigners();
  });

  describe("overlapping actions", () => {
    it("reverts on queueing overlapping actions in same proposal", async () => {
      const timelockFactory = await hre.ethers.getContractFactory("TimelockHarness");
      const delay =  86400 * 2
      const timelock = await timelockFactory.deploy(await root.getAddress(), delay)
  
      // Deploy gov token
      const wellFactory = await hre.ethers.getContractFactory("Well");
      const govToken = await wellFactory.deploy(await root.getAddress())

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
      const gov = await govFactory.deploy(
        timelock.address,
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

      const txAdmin = await send(timelock, 'harnessSetAdmin', [gov.address]);

      await enfranchise(govToken, a1, 288000001);

      const targets = [govToken.address, govToken.address];
      const values = ["0", "0"];
      const signatures = ["getBalanceOf(address)", "getBalanceOf(address)"];
      const calldatas = [encodeParameters(['address'], [await root.getAddress()]), encodeParameters(['address'], [await root.getAddress()])];
      await send(gov, 'propose', [targets, values, signatures, calldatas, "do nothing"], {from: a1});
      const proposalId = await call(gov, 'proposalCount')
      const proposal = await call(gov, "proposals", [proposalId])
      await mineBlockWithTimestamp(proposal.startTimestamp.add(1).toNumber())

      await send(gov, 'castVote', [proposalId, VOTE_YES], {from: a1});
      await mineBlockWithTimestamp(proposal.endTimestamp.add(1).toNumber())

      await expect(
        send(gov, 'queue', [proposalId])
      ).to.be.revertedWith("GovernorApollo::_queueOrRevert: proposal action already queued at eta");
    });

    it("reverts on queueing overlapping actions in different proposals, works if waiting", async () => {
      const timelockFactory = await hre.ethers.getContractFactory("TimelockHarness");
      const delay =  86400 * 2
      const timelock = await timelockFactory.deploy(await root.getAddress(), delay)
  
      // Deploy gov token
      const wellFactory = await hre.ethers.getContractFactory("Well");
      const govToken = await wellFactory.deploy(await root.getAddress())

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
      const gov = await govFactory.deploy(
        timelock.address,
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

      const txAdmin = await send(timelock, 'harnessSetAdmin', [gov.address]);

      await enfranchise(govToken, a1, 288000001);
      await enfranchise(govToken, a2, 288000001);

      const targets = [govToken.address];
      const values = ["0"];
      const signatures = ["getBalanceOf(address)"];
      const calldatas = [encodeParameters(['address'], [await root.getAddress()])];
      await send(gov, 'propose', [targets, values, signatures, calldatas, "do nothing"], {from: a1});
      await send(gov, 'propose', [targets, values, signatures, calldatas, "do nothing"], {from: a2});

      const proposalId = await call(gov, 'proposalCount')
      const proposal = await call(gov, "proposals", [proposalId])
      await mineBlockWithTimestamp(proposal.startTimestamp.add(1).toNumber())

      const txVote1 = await send(gov, 'castVote', [proposalId - 1, VOTE_YES], {from: a1});
      const txVote2 = await send(gov, 'castVote', [proposalId, VOTE_YES], {from: a2});
      await mineBlockWithTimestamp(proposal.endTimestamp.add(1).toNumber())

      // Stop mining blocks automatically
      await hre.ethers.provider.send("evm_setAutomine", [false]);

      // Send both transactions in the same block
      await send(gov, 'queue', [proposalId - 1]);
      await send(gov, 'queue', [proposalId]);

      // Mine the block
      await hre.ethers.provider.send("evm_mine", []);

      // First proposal should be queued and second will still be succeeded because it failse to queue (because it reverted)
      // TODO(lunar-eng): Actually catch the revert here.
      expect(await call(gov, 'state', [proposalId - 1])).to.be.equal(StateQueued)
      expect(await call(gov, 'state', [proposalId])).to.be.equal(StateSucceeded)

      // Start automining again, which changes the eta
      await hre.ethers.provider.send("evm_setAutomine", [true]);

      // Queue the second proposal
      await send(gov, 'queue', [proposalId]);

      // Verify it queue
      expect(await call(gov, 'state', [proposalId])).to.be.equal(StateQueued)
    });
  });
});