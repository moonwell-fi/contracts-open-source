const {
    encodeParameters,
} = require('../../Utils/Ethereum');
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { call, send, mineBlockWithTimestamp, resetHardhatNetwork  } from "../../utils";
const hre = require('hardhat')
import { expect } from "chai";
import { solidity } from "ethereum-waffle";
import chai from "chai";
import { BigNumber } from "ethers";
chai.use(solidity);

// Voting Constants
const VOTE_YES = 0
const VOTE_NO = 1
const VOTE_ABSTAIN = 2

const QUORUM = 300
const LOWER_QUORUM_CAP = 100
const UPPER_QUORUM_CAP = 500

async function enfranchise(govToken: any, actor: any, amount: number) {
  await send(govToken, 'transfer', [await actor.getAddress(), BigNumber.from(amount).mul(BigNumber.from(10).pow(18))]);
  await send(govToken, 'delegate', [await actor.getAddress()], { from: actor });
}

describe("GovernorApollo#castVote/2", () => {
  let govToken: any
  let gov: any
  let root: SignerWithAddress
  let a1: SignerWithAddress
  let accounts: Array<SignerWithAddress>

  let targets: Array<string>
  let values: Array<any>
  let signatures: Array<string>
  let callDatas: Array<string>
  let proposalId: number

  before(async () => {
    [root, a1, ...accounts] = await hre.ethers.getSigners();

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

    targets = [await a1.getAddress()];
    values = ["0"];
    signatures = ["getBalanceOf(address)"];
    callDatas = [encodeParameters(['address'], [await a1.getAddress()])];
    await send(govToken, 'delegate', [await root.getAddress()]);
    await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"]);
    proposalId = await call(gov, 'latestProposalIds', [await root.getAddress()]);
  });

  describe("We must revert if:", () => {
    it("There does not exist a proposal with matching proposal id where the current block number is between the proposal's start block (exclusive) and end block (inclusive)", async () => {
      await expect(
        call(gov, 'castVote', [proposalId, VOTE_YES])
      ).to.be.revertedWith("GovernorApollo::_castVote: voting is closed");
    });

    it("Such proposal already has an entry in its voters set matching the sender", async () => {
      const proposal = await gov.proposals(proposalId)
      await mineBlockWithTimestamp(proposal.startTimestamp.add(1).toNumber())

      await send(gov, 'castVote', [proposalId, VOTE_YES], { from: accounts[4] });
      await expect(
        send(gov, 'castVote', [proposalId, VOTE_YES], { from: accounts[4] })
      ).to.be.revertedWith("GovernorApollo::_castVote: voter already voted");
    });
  });

  describe("Otherwise", () => {
    it("we add the sender to the proposal's voters set", async () => {
      let receipt = await call(gov, 'getReceipt', [proposalId, await accounts[2].getAddress()])
      expect(receipt.hasVoted).to.be.false;
      await send(gov, 'castVote', [proposalId, VOTE_YES], { from: accounts[2] });

      receipt = await call(gov, 'getReceipt', [proposalId, await accounts[2].getAddress()])
      expect(receipt.hasVoted).to.be.true;
    });

    describe("and we take the balance returned by GetPriorVotes for the given sender and the proposal's start block, which may be zero,", () => {
      let actor; // an account that will propose, receive tokens, delegate to self, and vote on own proposal

      it("and we add that ForVotes", async () => {
        actor = accounts[1];
        await enfranchise(govToken, actor, 72000001);

        await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: actor });
        proposalId = await call(gov, 'latestProposalIds', [await actor.getAddress()]);

        let beforeFors = (await call(gov, 'proposals', [proposalId])).forVotes;
        const proposal = await gov.proposals(proposalId)
        await mineBlockWithTimestamp(proposal.startTimestamp.add(1).toNumber())
        await send(gov, 'castVote', [proposalId, VOTE_YES], { from: actor });

        let afterFors = (await call(gov, 'proposals', [proposalId])).forVotes;
        let afterTotalVotes = (await call(gov, 'proposals', [proposalId])).totalVotes;
        expect(afterFors).to.be.equal(beforeFors.add(BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))));
        expect(afterTotalVotes).to.be.equal(beforeFors.add(BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))));
      })

      it("or AgainstVotes corresponding to the caller's support flag.", async () => {
        actor = accounts[3];
        await enfranchise(govToken, actor, 72000001);

        await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: actor });
        proposalId = await call(gov, 'latestProposalIds', [await actor.getAddress()]);

        let beforeAgainsts = (await call(gov, 'proposals', [proposalId])).againstVotes;
        const proposal = await gov.proposals(proposalId)
        await mineBlockWithTimestamp(proposal.startTimestamp.add(1).toNumber())
        await send(gov, 'castVote', [proposalId, VOTE_NO], { from: actor });

        let afterAgainsts = (await call(gov, 'proposals', [proposalId])).againstVotes;
        let afterTotalVotes = (await call(gov, 'proposals', [proposalId])).totalVotes;
        expect(afterAgainsts).to.be.equal(beforeAgainsts.add(BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))));
        expect(afterTotalVotes).to.be.equal(beforeAgainsts.add(BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))));
      });

      it("or AbstainVotes corresponding to the caller's support flag.", async () => {
        actor = accounts[4];
        await enfranchise(govToken, actor, 72000001);

        await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: actor });
        proposalId = await call(gov, 'latestProposalIds', [await actor.getAddress()]);

        let beforeAbstains = (await call(gov, 'proposals', [proposalId])).abstainVotes;
        const proposal = await gov.proposals(proposalId)
        await mineBlockWithTimestamp(proposal.startTimestamp.add(1).toNumber())
        await send(gov, 'castVote', [proposalId, VOTE_ABSTAIN], { from: actor });

        let afterAbstains = (await call(gov, 'proposals', [proposalId])).abstainVotes;
        let afterTotalVotes = (await call(gov, 'proposals', [proposalId])).totalVotes;
        expect(afterAbstains).to.be.equal(beforeAbstains.add(BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))));
        expect(afterTotalVotes).to.be.equal(beforeAbstains.add(BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))));
      });
    });

    describe('castVoteBySig', () => {
      const makeDomain = (govContract: any, chainId: string) => ({ name: 'Moonwell Apollo Governor', chainId, verifyingContract: govContract.address });
      const TYPES = {
        Ballot: [
          {name: 'proposalId', type: 'uint256' },
          {name: 'voteValue', type: 'uint8' },
        ]
      };
    
      it('reverts if the signatory is invalid', async () => {
        await expect(send(gov, 'castVoteBySig', [proposalId, VOTE_YES, 0, '0xbad122334455667788990011223344556677889900112233445566778899aaaa', '0xbad122334455667788990011223344556677889900112233445566778899aaaa'])).to.be.revertedWith("GovernorApollo::castVoteBySig: invalid signature");
      });

      it('casts vote on behalf of the signatory', async () => {
        await enfranchise(govToken, a1, 72000001);
        await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: a1 });
        proposalId = await call(gov, 'latestProposalIds', [await a1.getAddress()]);;

        const chainId = hre.network.config.chainId
        const domain = makeDomain(gov, chainId)

        const signature = await (a1 as any)._signTypedData(domain, TYPES, {proposalId: proposalId, voteValue: VOTE_YES })

        // Slice off 0x
        const unprefixed = signature.slice(2)
        const r = unprefixed.slice(0, 64)
        const s = unprefixed.slice(64, 128)
        const v = unprefixed.slice(128)

        let beforeFors = (await call(gov, 'proposals', [proposalId])).forVotes;
        const proposal = await gov.proposals(proposalId)
        await mineBlockWithTimestamp(proposal.startTimestamp.add(1).toNumber())

        const tx = await send(gov, 'castVoteBySig', [proposalId, VOTE_YES, `0x${v}`, `0x${r}`, `0x${s}`], { from: a1});
        expect(tx.gasUsed < 80000);

        let afterFors = (await call(gov, 'proposals', [proposalId])).forVotes;
        let afterTotalVotes = (await call(gov, 'proposals', [proposalId])).totalVotes;
        expect(afterFors).to.be.equal(beforeFors.add(BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))));
        expect(afterTotalVotes).to.be.equal(beforeFors.add(BigNumber.from(72000001).mul(BigNumber.from(10).pow(18))));
      });
    });

    // TODO(lunar-eng): Enable when we support logging.
    // it("receipt uses one load", async () => {
    //   let actor = accounts[2];
    //   let actor2 = accounts[3];
    //   await enfranchise(govToken, actor, 400001);
    //   await enfranchise(govToken, actor2, 400001);
    //   await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: actor });
    //   proposalId = await call(gov, 'latestProposalIds', [actor]);

    //   await mineBlock();
    //   await mineBlock();
    //   await send(gov, 'castVote', [proposalId, true], { from: actor });
    //   await send(gov, 'castVote', [proposalId, false], { from: actor2 });

    //   let trxReceipt = await send(gov, 'getReceipt', [proposalId, actor]);
    //   let trxReceipt2 = await send(gov, 'getReceipt', [proposalId, actor2]);

    //   await saddle.trace(trxReceipt, {
    //     constants: {
    //       "account": actor
    //     },
    //     preFilter: ({op}) => op === 'SLOAD',
    //     postFilter: ({source}) => !source || source.includes('receipts'),
    //     execLog: (log) => {
    //       let [output] = log.outputs;
    //       let votes = "000000000000000000000000000000000000000054b419003bdf81640000";
    //       let voted = "01";
    //       let support = "01";

    //       expect(output).toEqual(
    //         `${votes}${support}${voted}`
    //       );
    //     },
    //     exec: (logs) => {
    //       expect(logs.length).toEqual(1); // require only one read
    //     }
    //   });

    //   await saddle.trace(trxReceipt2, {
    //     constants: {
    //       "account": actor2
    //     },
    //     preFilter: ({op}) => op === 'SLOAD',
    //     postFilter: ({source}) => !source || source.includes('receipts'),
    //     execLog: (log) => {
    //       let [output] = log.outputs;
    //       let votes = "0000000000000000000000000000000000000000a968320077bf02c80000";
    //       let voted = "01";
    //       let support = "00";

    //       expect(output).toEqual(
    //         `${votes}${support}${voted}`
    //       );
    //     }
    //   });
    // });
  });
});