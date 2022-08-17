import { BigNumber, Signer } from "ethers";
import { call, send } from "./utils";
const { ethers } = require('hardhat')
const hre = require('hardhat')
import { expect } from "chai";
import { mineBlockWithTimestamp, resetHardhatNetwork } from '../tests/utils'
import { solidity } from "ethereum-waffle";
import chai from "chai";

chai.use(solidity);

describe('TokenDistributorVotes', () => {
  // The root account which is the admin
  let root: Signer

  // A user who can claim tokens
  let alice: Signer

  // The ID of the chain, used for delegating by signatures
  let chainId: string

  // The claims contract under test
  let claimsContract: any

  // The token that will be added to the claims contract 
  let rewardToken: any

  // The starting epoch for vesting
  let epoch: BigNumber

  // Vesting parameters
  const VESTING_DURATION = BigNumber.from(86400 * 365);
  const CLIFF = BigNumber.from(86400 * 90);
  const CLIFF_PERCENTAGE = BigNumber.from(50).mul(BigNumber.from(10).pow(16));

  // Delegation Parameters
  const makeDomain = (claimsContract: any, chainId: string) => ({ name: 'vWELL', chainId, verifyingContract: claimsContract.address });
  const TYPES = {
    Delegation: [
      { name: 'delegatee', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' }
    ]
  };


  beforeEach(async () => {
    await resetHardhatNetwork();

    [root, alice] = await hre.ethers.getSigners();

    chainId = hre.network.config.chainId

    const TokenSaleDistributorProxyFactory = await hre.ethers.getContractFactory("TokenSaleDistributorProxy");
    const TokenSaleDistributorFactory = await hre.ethers.getContractFactory("TokenSaleDistributor");

    const proxy = await TokenSaleDistributorProxyFactory.deploy();
    const implementation = await TokenSaleDistributorFactory.deploy();

    await proxy.setPendingImplementation(implementation.address);
    await (await implementation.becomeImplementation(proxy.address)).wait();

    claimsContract = TokenSaleDistributorFactory.attach(proxy.address);

    const FaucetTokenFactory = await hre.ethers.getContractFactory("FaucetToken");
    rewardToken = await FaucetTokenFactory.deploy(
      ethers.utils.parseEther("7200000000"),
      "Vested Token",
      BigNumber.from(18),
      "VT",
    );

    await claimsContract.setTokenAddress(rewardToken.address);
    await rewardToken.transfer(claimsContract.address, ethers.utils.parseEther("7200000000"));

    epoch = BigNumber.from(Math.floor(new Date().getTime() / 1000));

    await send(claimsContract, 'delegate', [await alice.getAddress()], { from: alice })

    await send(claimsContract, 'setVotingEnabled', [true])
  });

  it('getCurrentVotes - calculates one allocation correctly', async () => {
    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])

    // WHEN Alice's votes are tallied
    // THEN she has the same amount as her allocations
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(amount)
  })

  it('getCurrentVotes - calculates two allocations correctly', async () => {
    // GIVEN Alice has two allocations
    const amount1 = BigNumber.from('10000')
    const amount2 = BigNumber.from('20000')
    const aliceAddress = await alice.getAddress()

    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount1]])
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount2]])

    // WHEN Alice's votes are tallied
    // THEN she has the sum of both allocations
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(amount1.add(amount2))
  })

  it('getCurrentVotes - calculates allocations correctly after time has passed', async () => {
    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])

    // WHEN the allocation becomes partially vested
    await mineBlockWithTimestamp(epoch.add(CLIFF).toNumber());

    // THEN Alice still retains full voting power.
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(amount)
  })

  it('getCurrentVotes - returns zero if there are no checkpoints', async () => {
    // GIVEN Alice has no allocations
    // WHEN her voting power is requested
    // THEN her voting power is zero.
    expect(await call(claimsContract, 'getCurrentVotes', [await alice.getAddress()])).to.equal(0)
  })

  it('getPriorVotes - calculates allocations correctly when claims have occurred', async () => {
    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])

    // WHEN the allocation becomes halfway vested and is claimed
    await mineBlockWithTimestamp(epoch.add(CLIFF).toNumber());
    await send(claimsContract, 'claim', [], { from: alice })

    // THEN Alice's voting power is reduced
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(amount.div(2))
  })

  it('getPriorVotes - snapshots claims correctly', async () => {
    // Turn off automine
    await ethers.provider.send("evm_setAutomine", [false]);

    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    await ethers.provider.send("evm_mine", []);

    // WHEN she claims tokens
    const startingBlock = (await hre.ethers.provider.getBlock("latest")).number

    await mineBlockWithTimestamp(epoch.add(CLIFF).toNumber());
    await send(claimsContract, 'claim', [], { from: alice })
    await ethers.provider.send("evm_mine", []);
    const halfwayClaimBlock = (await hre.ethers.provider.getBlock("latest")).number

    await mineBlockWithTimestamp(epoch.add(VESTING_DURATION.add(CLIFF)).toNumber());
    await send(claimsContract, 'claim', [], { from: alice })
    await ethers.provider.send("evm_mine", []);
    const fullClaimBlock = (await hre.ethers.provider.getBlock("latest")).number
    await ethers.provider.send("evm_mine", []);

    // THEN snapshots are calculated correctly
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startingBlock])).to.equal(amount)
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, halfwayClaimBlock])).to.equal(amount.div(2))
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, fullClaimBlock])).to.equal(0)
  })

  it('getPriorVotes - returns 0 if before first checkpoint', async () => {
    // Turn off automine
    await ethers.provider.send("evm_setAutomine", [false]);
    await ethers.provider.send("evm_mine", []);
    const earlyBlock = (await hre.ethers.provider.getBlock("latest")).number

    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    await ethers.provider.send("evm_mine", []);

    // WHEN a snapshot is requested before Alice's first checkpoint
    // THEN the call reverts
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, earlyBlock])).to.equal(0)
  })

  it('getPriorVotes - reverts if a block is at head', async () => {
    // Turn off automine
    await ethers.provider.send("evm_setAutomine", [false]);

    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    const currentBlock = (await hre.ethers.provider.getBlock("latest")).number

    // WHEN a snapshot is requested in the same block
    // THEN the call reverts
    await expect(call(claimsContract, 'getPriorVotes', [aliceAddress, currentBlock])).to.be.revertedWith('not yet determined')
  })

  it('getPriorVotes - reverts if a block is in the future', async () => {
    // Turn off automine
    await ethers.provider.send("evm_setAutomine", [false]);

    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    const currentBlock = (await hre.ethers.provider.getBlock("latest")).number

    // WHEN a snapshot is requested in a future block
    // THEN the call reverts
    await expect(call(claimsContract, 'getPriorVotes', [aliceAddress, currentBlock + 1])).to.be.revertedWith('not yet determined')
  })

  it('getPriorVotes - returns zero if there are no checkpoints', async () => {
    // GIVEN Alice has no allocations
    const aliceAddress = await alice.getAddress()

    // WHEN a snapshot is requested in a future block
    // THEN the call returns zero
    const currentBlock = (await hre.ethers.provider.getBlock("latest")).number
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, currentBlock - 1])).to.equal(0)
  })

  it('getPriorVotes - generally returns the voting balance at the appropriate checkpoint', async () => {
    // Turn off automine
    await ethers.provider.send("evm_setAutomine", [false]);
    await ethers.provider.send("evm_mine", []); // Start
    const startBlock = (await hre.ethers.provider.getBlock("latest")).number

    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()

    // Time 1 - 10,000 allocated
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    await ethers.provider.send("evm_mine", []); // Start + 1
    await ethers.provider.send("evm_mine", []); // Start + 2

    // Time 2 - 20,000 allocated
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    await ethers.provider.send("evm_mine", []); // Start + 3
    await ethers.provider.send("evm_mine", []); // Start + 4

    // Time 3 - 30,000 allocated
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    await ethers.provider.send("evm_mine", []); // Start + 5
    await ethers.provider.send("evm_mine", []); // Start + 6

    // Time 4 - 40,000 allocated
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    await ethers.provider.send("evm_mine", []); // Start + 7
    await ethers.provider.send("evm_mine", []); // Start + 8

    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock])).to.equal(0);
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock + 1])).to.equal(10000);
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock + 2])).to.equal(10000);
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock + 3])).to.equal(20000);
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock + 4])).to.equal(20000);
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock + 5])).to.equal(30000);
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock + 6])).to.equal(30000);
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock + 7])).to.equal(40000);
  });

  it('numCheckpoints - calculates numbers of checkpoints correctly', async () => {
    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    expect(await call(claimsContract, 'numCheckpoints', [aliceAddress])).to.equal(1)

    // WHEN she claims tokens then checkpoints are calculated correctly
    await mineBlockWithTimestamp(epoch.add(CLIFF).toNumber());
    await send(claimsContract, 'claim', [], { from: alice })
    expect(await call(claimsContract, 'numCheckpoints', [aliceAddress])).to.equal(2)

    await mineBlockWithTimestamp(epoch.add(VESTING_DURATION.add(CLIFF)).toNumber());
    await send(claimsContract, 'claim', [], { from: alice })
    expect(await call(claimsContract, 'numCheckpoints', [aliceAddress])).to.equal(3)
  });

  it('numCheckpoints - does not add checkpoints if zero are claimed', async () => {
    // GIVEN Alice has one allocation and one checkpoint
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    expect(await call(claimsContract, 'numCheckpoints', [aliceAddress])).to.equal(1)

    // WHEN she claims tokens before her cliff
    await mineBlockWithTimestamp(epoch.add(CLIFF.div(2)).toNumber());
    await send(claimsContract, 'claim', [], { from: alice })

    // THEN no checkpoints are added
    expect(await call(claimsContract, 'numCheckpoints', [aliceAddress])).to.equal(1)
  });

  it('numCheckpoints - does not add checkpoints in the same block', async () => {
    // GIVEN Alice has one allocation and one checkpoint
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    expect(await call(claimsContract, 'numCheckpoints', [aliceAddress])).to.equal(1)

    // WHEN she claims tokens before her cliff
    await mineBlockWithTimestamp(epoch.add(CLIFF.div(2)).toNumber());
    await send(claimsContract, 'claim', [], { from: alice })

    // THEN no checkpoints are added
    expect(await call(claimsContract, 'numCheckpoints', [aliceAddress])).to.equal(1)
  });

  it('reverts if the signatory is invalid', async () => {
    const delegatee = await root.getAddress();
    const nonce = 0;
    const expiry = 10e9;
    await expect(
      send(
        claimsContract,
        'delegateBySig',
        [
          delegatee,
          nonce,
          expiry,
          0,
          '0xbad122334455667788990011223344556677889900112233445566778899aaaa',
          '0xbad122334455667788990011223344556677889900112233445566778899aaaa'
        ],
        { from: alice }
      )
    ).to.be.revertedWith("invalid sig");
  });

  it('reverts if the nonce is bad ', async () => {
    const delegatee = await root.getAddress();
    const nonce = 1;
    const expiry = 10e9;
    const domain = makeDomain(claimsContract, chainId)

    const signature = await (alice as any)._signTypedData(domain, TYPES, { delegatee, nonce, expiry })

    // Slice off 0x
    const unprefixed = signature.slice(2)
    const r = unprefixed.slice(0, 64)
    const s = unprefixed.slice(64, 128)
    const v = unprefixed.slice(128)

    await expect(
      send(
        claimsContract,
        'delegateBySig',
        [
          delegatee,
          nonce,
          expiry,
          `0x${v}`,
          `0x${r}`,
          `0x${s}`
        ],
        { from: alice }
      )
    ).to.be.revertedWith("invalid nonce");
  });

  it('reverts if the signature has expired', async () => {
    const delegatee = await root.getAddress();
    const nonce = 0;
    const expiry = 0;
    const domain = makeDomain(claimsContract, chainId)

    const signature = await (alice as any)._signTypedData(domain, TYPES, { delegatee, nonce, expiry })

    // Slice off 0x
    const unprefixed = signature.slice(2)
    const r = unprefixed.slice(0, 64)
    const s = unprefixed.slice(64, 128)
    const v = unprefixed.slice(128)

    await expect(
      send(
        claimsContract,
        'delegateBySig',
        [
          delegatee,
          nonce,
          expiry,
          `0x${v}`,
          `0x${r}`,
          `0x${s}`
        ],
        { from: alice }
      )
    ).to.be.revertedWith("signature expired");
  });

  it('delegates on behalf of the signatory', async () => {
    const delegatee = await root.getAddress()

    // GIVEN that Alice has an allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])

    // AND the delegate is delegated to itself.
    await send(claimsContract, 'delegate', [delegatee], { from: root })

    // THEN Alice has the voting power and the delegate has zero
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(amount)
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(0)

    // WHEN Alice signs a delegate message
    const nonce = 0
    const expiry = 10e9;
    const domain = makeDomain(claimsContract, chainId)
    const signature = await (alice as any)._signTypedData(domain, TYPES, { delegatee, nonce, expiry })

    // Slice off 0x
    const unprefixed = signature.slice(2)
    const r = unprefixed.slice(0, 64)
    const s = unprefixed.slice(64, 128)
    const v = unprefixed.slice(128)

    await
      send(
        claimsContract,
        'delegateBySig',
        [
          delegatee,
          nonce,
          expiry,
          `0x${v}`,
          `0x${r}`,
          `0x${s}`
        ],
        { from: alice }
      )

    // THEN Alice has a delegate set.
    expect(await call(claimsContract, 'delegates', [aliceAddress])).to.equal(delegatee)

    // AND voting power is transferred to the delegate
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(0)
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(amount)
  });

  it('updates delegate voting when claiming', async () => {
    await ethers.provider.send("evm_setAutomine", [false]);
    await ethers.provider.send("evm_mine", []);

    const delegatee = await root.getAddress()

    // GIVEN that Alice has an allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    await ethers.provider.send("evm_mine", []);

    // AND the delegate is delegated to itself.
    await send(claimsContract, 'delegate', [delegatee], { from: root })
    await ethers.provider.send("evm_mine", []);

    // THEN Alice has the voting power and the delegate has zero
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(amount)
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(0)

    // WHEN Alice delegates to the delegate
    await send(claimsContract, 'delegate', [delegatee], { from: alice })
    await ethers.provider.send("evm_mine", []);

    // THEN Alice has a delegate set.
    expect(await call(claimsContract, 'delegates', [aliceAddress])).to.equal(delegatee)

    // AND voting power is transferred to the delegate
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(0)
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(amount)

    // WHEN when Alice claims half of her tokens
    await mineBlockWithTimestamp(epoch.add(CLIFF).toNumber());
    await send(claimsContract, 'claim', [], { from: alice })
    await ethers.provider.send("evm_mine", []);

    // THEN the delegate's voting power is halved
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(0)
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(amount.div(2))

    // WHEN Alice redelegates to herself
    await send(claimsContract, 'delegate', [aliceAddress], { from: alice })
    await ethers.provider.send("evm_mine", []);

    // THEN Alice receives half the voting power
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(amount.div(2))
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(0)
  });

  it('withdraw - reduces a users voting power', async () => {
    // GIVEN the voting contract has some tokens other than the reward token
    const FaucetTokenFactory = await hre.ethers.getContractFactory("FaucetToken");
    const otherTokenAmount = ethers.utils.parseEther("1000000")
    const otherToken = await FaucetTokenFactory.deploy(
      otherTokenAmount,
      "Other Token",
      BigNumber.from(18),
      "OT",
    );

    await otherToken.transfer(claimsContract.address, otherTokenAmount);

    // WHEN the admin withdraws the other tokens
    await send(claimsContract, 'withdraw', [otherToken.address, otherTokenAmount])

    // THEN the tokens are moved to Alice's address
    expect(await call(otherToken, 'balanceOf', [claimsContract.address])).to.equal(0)
    expect(await call(otherToken, 'balanceOf', [await root.getAddress()])).to.equal(otherTokenAmount)
  })

  it('withdraw - failse if the token to withdraw is the reward token', async () => {
    // GIVEN the voting contract
    // WHEN the admin tries to withdraw the reward tokens
    // THEN the call reverts
    await expect(send(claimsContract, 'withdraw', [rewardToken.address, "1"])).to.be.revertedWith('use resetAllocationsByUser')
  })

  it('disableVoting - can enable and disable voting', async () => {
    // GIVEN Alice has one allocation
    const amount = BigNumber.from('10000')
    const aliceAddress = await alice.getAddress()
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount]])
    const startBlock = (await hre.ethers.provider.getBlock("latest")).number

    // WHEN voting is disabled
    await send(claimsContract, 'setVotingEnabled', [false])

    // THEN Alice's voting power is reduced to zero.
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(0)
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock])).to.equal(0)

    // WHEN voting is enabled
    await send(claimsContract, 'setVotingEnabled', [true])

    // THEN Alice's voting pwoer is returned
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(amount)
    expect(await call(claimsContract, 'getPriorVotes', [aliceAddress, startBlock])).to.equal(amount)
  })


  it('resetAllocationsByUser - updates voting power', async () => {
    const delegatee = await root.getAddress()

    // GIVEN Alice has two allocations
    const amount1 = BigNumber.from('10000')
    const amount2 = BigNumber.from('20000')
    const aliceTotalAllocations = amount1.add(amount2)
    const aliceAddress = await alice.getAddress()

    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount1]])
    await send(claimsContract, 'setAllocations', [[aliceAddress], [true], [epoch], [VESTING_DURATION], [CLIFF], [CLIFF_PERCENTAGE], [amount2]])

    // AND the delegate is delegated to the admin
    await send(claimsContract, 'delegate', [delegatee], { from: root })

    // THEN Alice has the voting power and the delegate has zero
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(aliceTotalAllocations)
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(0)

    // WHEN Alice delegates to the delegate
    await send(claimsContract, 'delegate', [delegatee], { from: alice })

    // THEN Alice has a delegate set.
    expect(await call(claimsContract, 'delegates', [aliceAddress])).to.equal(delegatee)

    // AND voting power is transferred to the delegate
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(0)
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(aliceTotalAllocations)

    // WHEN when Alice's claims are reset
    await send(claimsContract, 'resetAllocationsByUser', [aliceAddress])

    // THEN the delegate's voting power is reduced
    expect(await call(claimsContract, 'getCurrentVotes', [delegatee])).to.equal(0)

    // AND Alice has no voting power
    expect(await call(claimsContract, 'getCurrentVotes', [aliceAddress])).to.equal(0)

    // AND the admin takes possesion of the tokens.
    console.log(JSON.stringify(rewardToken.methods, null, 2))
    expect(await call(rewardToken, 'balanceOf', [await root.getAddress()])).to.equal(aliceTotalAllocations)
  });

});
