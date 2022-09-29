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

chai.use(solidity);

// State constants
const StatePending = 0
const StateActive = 1
const StateCanceled = 2
const StateDefeated = 3
const StateSucceeded = 4
const StateQueued = 5
const StateExpired = 6
const StateExecuted = 7

// Voting Constants
const VOTE_YES = 0
const VOTE_NO = 1
const VOTE_ABSTAIN = 2

const QUORUM = 300
const LOWER_QUORUM_CAP = 100
const UPPER_QUORUM_CAP = 500

describe('GovernorApollo#state/1', () => {
  let govToken: any
  let gov: any
  let root: SignerWithAddress 
  let acct: SignerWithAddress
  let accounts: Array<SignerWithAddress>
  let delay: BigNumber
  let timelock: any

  before(async () => {
    await resetHardhatNetwork();

    [root, acct, ...accounts] = await hre.ethers.getSigners();

    let blockTimestamp = BigNumber.from(Math.floor(Date.now() / 1000))
    await freezeTime(blockTimestamp)
    
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

    delay = BigNumber.from(7 * 24 * 60 * 60);

    const timelockFactory = await hre.ethers.getContractFactory("TimelockHarness");
    timelock = await timelockFactory.deploy(await root.getAddress(), delay)


    const govFactory = await hre.ethers.getContractFactory("MoonwellGovernorApollo")
    gov = await govFactory.deploy(
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

    await send(timelock, "harnessSetAdmin", [gov.address])
    await send(govToken, 'transfer', [await acct.getAddress(), BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))]);
    await send(govToken, 'delegate', [await acct.getAddress()], { from: acct });
  });

  let trivialProposal: any
  let targets: Array<string>
  let values: Array<string>
  let signatures: Array<string> 
  let callDatas: Array<string>
  let proposalId: number

  before(async () => {
    targets = [await root.getAddress()];
    values = ["0"];
    signatures = ["getBalanceOf(address)"]
    callDatas = [encodeParameters(['address'], [await acct.getAddress()])];
    await send(govToken, 'delegate', [await root.getAddress()]);
    await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"]);
    proposalId = await call(gov, 'latestProposalIds', [await root.getAddress()]);
    trivialProposal = await call(gov, "proposals", [proposalId])
  })

  it("Invalid for proposal not found", async () => {
    await expect(call(gov, 'state', ["5"])).to.be.revertedWith("GovernorApollo::state: invalid proposal id")
  })

  it("Pending", async () => {
    expect(await call(gov, 'state', [trivialProposal.id])).to.be.equal(StatePending)
  })

  it("Active", async () => {
    await mineBlockWithTimestamp(trivialProposal.startTimestamp.add(1).toNumber())

    expect(await call(gov, 'state', [trivialProposal.id])).to.be.equal(StateActive)
  })

  it("Canceled", async () => {
    await send(govToken, 'transfer', [await accounts[0].getAddress(), BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))]);
    await send(govToken, 'delegate', [await accounts[0].getAddress()], { from: accounts[0] });
    await mineBlockWithTimestamp(trivialProposal.endTimestamp.add(1).toNumber())
    await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: accounts[0] })
    let newProposalId = await call(gov, 'proposalCount')

    // send away the delegates
    await send(govToken, 'delegate', [await root.getAddress()], { from: accounts[0] });
    await send(gov, 'cancel', [newProposalId])

    expect(await call(gov, 'state', [+newProposalId])).to.be.equal(StateCanceled)
  })

  it("Defeated", async () => {
    expect(await call(gov, 'state', [trivialProposal.id])).to.be.equal(StateDefeated)
  })

  it("Succeeded", async () => {
    await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: acct })
    proposalId = await call(gov, 'latestProposalIds', [await acct.getAddress()]);
    trivialProposal = await call(gov, "proposals", [proposalId])
    await mineBlockWithTimestamp(trivialProposal.startTimestamp.add(1).toNumber())
    await send(gov, 'castVote', [proposalId, VOTE_YES])
    await mineBlockWithTimestamp(trivialProposal.endTimestamp.add(1).toNumber())

    expect(await call(gov, 'state', [proposalId])).to.be.equal(StateSucceeded)
  })

  it("Queued", async () => {
    await send(gov, 'queue', [proposalId], { from: acct })
    expect(await call(gov, 'state', [proposalId])).to.be.equal(StateQueued)
  })

  it("Expired", async () => {
    let gracePeriod = await call(timelock, 'GRACE_PERIOD')

    await mineBlockWithTimestamp(trivialProposal.endTimestamp.add(gracePeriod).sub(1).toNumber())

    expect(await call(gov, 'state', [proposalId])).to.be.equal(StateQueued)

    trivialProposal = await call(gov, "proposals", [proposalId])
    await mineBlockWithTimestamp(trivialProposal.eta.add(gracePeriod).add(1).toNumber())

    expect(await call(gov, 'state', [proposalId])).to.be.equal(StateExpired)
  })

  it("Executed", async () => {
    await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: acct })
    proposalId = await call(gov, 'latestProposalIds', [await acct.getAddress()]);
    trivialProposal = await call(gov, "proposals", [proposalId])

    await mineBlockWithTimestamp(trivialProposal.startTimestamp.add(1).toNumber())
    await send(gov, 'castVote', [proposalId, VOTE_YES])
    await mineBlockWithTimestamp(trivialProposal.endTimestamp.add(1).toNumber())

    await send(gov, 'queue', [proposalId], { from: acct })

    let gracePeriod = await call(timelock, 'GRACE_PERIOD')
    let p = await call(gov, "proposals", [proposalId]);
    let eta = p.eta

    await mineBlockWithTimestamp(eta.add(1).toNumber())

    expect(await call(gov, 'state', [proposalId])).to.be.equal(StateQueued)
    await send(gov, 'execute', [proposalId], { from: acct })

    expect(await call(gov, 'state', [proposalId])).to.be.equal(StateExecuted)

    // still executed even though would be expired
    await mineBlockWithTimestamp(eta.add(gracePeriod).add(1).toNumber())

    expect(await call(gov, 'state', [proposalId])).to.be.equal(StateExecuted)
  })

})