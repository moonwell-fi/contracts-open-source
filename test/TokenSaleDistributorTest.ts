const hre = require('hardhat')
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  increaseTime,
  resetHardhatNetwork,
  mineBlockWithTimestamp,
  setNextBlockTimestamp,
} from "../tests/utils";

const {
  BigNumber,
  utils: {
    parseEther,
  },
} = hre.ethers;

describe("TokenSaleDistributor", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let tokenSaleDistributor: any;
  let token: any;

  /**
   * Deploys the TokenSaleDistributorProxy contract with the underlying implementation contract.
   * A "Vested Token" ("VT") faucet token is set as the vested token and 7.2B VT is minted
   * to the deployer. 1M of this is transferred from the deployer to the proxy.
   */
  const deployTokenSaleDistributor = async function () {
    [deployer, user] = await hre.ethers.getSigners();

    const TokenSaleDistributorProxyFactory = await hre.ethers.getContractFactory("TokenSaleDistributorProxy");
    const TokenSaleDistributorFactory = await hre.ethers.getContractFactory("TokenSaleDistributor");

    const proxy = await TokenSaleDistributorProxyFactory.deploy();
    const implementation = await TokenSaleDistributorFactory.deploy();

    await proxy.setPendingImplementation(implementation.address);
    await (await implementation.becomeImplementation(proxy.address)).wait();

    tokenSaleDistributor = TokenSaleDistributorFactory.attach(proxy.address);

    const FaucetTokenFactory = await hre.ethers.getContractFactory("FaucetToken");
    token = await FaucetTokenFactory.deploy(
      parseEther("7200000000"),
      "Vested Token",
      BigNumber.from(18),
      "VT",
    );

    await tokenSaleDistributor.setTokenAddress(token.address);
    await token.transfer(tokenSaleDistributor.address, parseEther("1000000"));
  }

  describe("Linear Vesting", function () {
    const epoch = BigNumber.from(Math.floor(new Date().getTime() / 1000));
    const vestingDuration = BigNumber.from(86400 * 365);
    const cliff = BigNumber.from(86400 * 90);
    const cliffPercentage = BigNumber.from(50).mul(BigNumber.from(10).pow(16));
    const amount = parseEther("10000");

    async function prepare () {
      await resetHardhatNetwork();
      await deployTokenSaleDistributor();
      await tokenSaleDistributor.setAllocations(
        [user.address],
        [true],
        [epoch],
        [vestingDuration],
        [cliff],
        [cliffPercentage],
        [amount],
      );
    }

    describe("General", function () {
      before(prepare);

      it("total allocations", async function () {
        expect(await tokenSaleDistributor.totalAllocations(user.address)).to.equal(1);
      });

      it("total allocated", async function () {
        expect(await tokenSaleDistributor.totalAllocated(user.address)).to.equal(amount);
      });

      it("allocation metadata", async function () {
        const allocations = await tokenSaleDistributor.getUserAllocations(user.address);

        expect(allocations.length).to.equal(1);
        expect(allocations[0].isLinear).to.be.true;
        expect(allocations[0].epoch).to.equal(epoch);
        expect(allocations[0].vestingDuration).to.equal(vestingDuration);
        expect(allocations[0].cliff).to.equal(cliff);
        expect(allocations[0].amount).to.equal(amount);
        expect(allocations[0].claimed).to.equal(0);
      });
    });

    describe("Vesting", function () {
      before(prepare);

      it("zero claimable before cliff", async function () {
        expect(await tokenSaleDistributor.totalClaimable(user.address)).to.equal(0);
        await increaseTime(cliff.div(2).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address)).to.equal(0);
      });

      it("cliff percentage claimable at cliff", async function () {
        await mineBlockWithTimestamp(epoch.add(cliff).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address))
          .to.equal(amount.mul(cliffPercentage).div(parseEther("1")));
      });

      it("vested amount grows linearly", async function () {
        const initialAmount = amount.mul(cliffPercentage).div(parseEther("1"));
        const linearlyVestedAmount = amount.sub(initialAmount);

        await mineBlockWithTimestamp(epoch.add(cliff).add(86400 * 30).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address))
          .to.equal(initialAmount.add(linearlyVestedAmount.mul(86400 * 30).div(vestingDuration)));

        await mineBlockWithTimestamp(epoch.add(cliff).add(86400 * 60).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address))
          .to.equal(initialAmount.add(linearlyVestedAmount.mul(86400 * 60).div(vestingDuration)));

        await mineBlockWithTimestamp(epoch.add(cliff).add(86400 * 125).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address))
          .to.equal(initialAmount.add(linearlyVestedAmount.mul(86400 * 125).div(vestingDuration)));
      });

      it("100 % claimable at epoch + cliff + duration", async function () {
        await mineBlockWithTimestamp(epoch.add(cliff).add(vestingDuration).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address)).to.equal(amount);
      });
    });

    describe("Claiming", function () {
      before(prepare);

      it("claiming does not transfer tokens before cliff", async function () {
        await tokenSaleDistributor.connect(user).claim();
        expect(await token.balanceOf(user.address)).to.equal(0);
      });

      it("claiming after cliff transfers cliff percentage tokens", async function () {
        await setNextBlockTimestamp(epoch.add(cliff).toNumber());
        await tokenSaleDistributor.connect(user).claim();
        expect(await token.balanceOf(user.address))
          .to.equal(amount.mul(cliffPercentage).div(parseEther("1")));
      });

      it("transfers correct amounts at subsequent claims", async function () {
        const initialAmount = amount.mul(cliffPercentage).div(parseEther("1"));

        const timeDeltas = [3453, 12345, 74235, 100000];
        let cumulativeTimeDelta = 0;

        for (let i = 0; i < timeDeltas.length; i += 1) {
          cumulativeTimeDelta += timeDeltas[i];
          const expectedAmount = initialAmount.add(
            amount
              .sub(initialAmount)
              .mul(cumulativeTimeDelta)
              .div(vestingDuration),
          );

          await setNextBlockTimestamp(epoch.add(cliff).toNumber() + cumulativeTimeDelta);
          await tokenSaleDistributor.connect(user).claim();
          expect(await token.balanceOf(user.address)).to.equal(expectedAmount)
        }
      });

      it("transfers all remaining tokens after the vesting period has elapsed", async function () {
        await setNextBlockTimestamp(epoch.add(cliff).add(vestingDuration).toNumber());
        await tokenSaleDistributor.connect(user).claim();

        expect(await token.balanceOf(user.address)).to.equal(amount);
      });

      it("transfer nothing after all vested tokens are claimed", async function () {
        await increaseTime(12345);
        await tokenSaleDistributor.connect(user).claim();

        expect(await token.balanceOf(user.address)).to.equal(amount);
      });
    });
  });

  describe("Monthly Vesting", function () {
    const epoch = BigNumber.from(Math.floor(new Date().getTime() / 1000));
    const vestingDuration = BigNumber.from(12);
    const cliff = BigNumber.from(86400 * 60);
    const cliffPercentage = BigNumber.from(90).mul(BigNumber.from(10).pow(16));
    const amount = parseEther("10000");
    const month = BigNumber.from(86400 * 365 / 12);

    async function prepare () {
      await resetHardhatNetwork();
      await deployTokenSaleDistributor();
      await tokenSaleDistributor.setAllocations(
        [user.address],
        [false],
        [epoch],
        [vestingDuration],
        [cliff],
        [cliffPercentage],
        [amount],
      );
    }

    describe("General", function () {
      before(prepare);

      it("total allocations", async function () {
        expect(await tokenSaleDistributor.totalAllocations(user.address)).to.equal(1);
      });

      it("total allocated", async function () {
        expect(await tokenSaleDistributor.totalAllocated(user.address)).to.equal(amount);
      });

      it("allocation metadata", async function () {
        const allocations = await tokenSaleDistributor.getUserAllocations(user.address);

        expect(allocations.length).to.equal(1);
        expect(allocations[0].isLinear).to.be.false;
        expect(allocations[0].epoch).to.equal(epoch);
        expect(allocations[0].vestingDuration).to.equal(vestingDuration);
        expect(allocations[0].cliff).to.equal(cliff);
        expect(allocations[0].amount).to.equal(amount);
        expect(allocations[0].claimed).to.equal(0);
      });
    });

    describe("Vesting", function () {
      before(prepare);

      it("zero claimable before cliff", async function () {
        expect(await tokenSaleDistributor.totalClaimable(user.address)).to.equal(0);
        await increaseTime(cliff.div(2).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address)).to.equal(0);
      });

      it("cliff percentage claimable at cliff", async function () {
        await mineBlockWithTimestamp(epoch.add(cliff).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address))
          .to.equal(amount.mul(cliffPercentage).div(parseEther("1")));
      });

      it("vested amount grows monthly", async function () {
        const initialAmount = amount.mul(cliffPercentage).div(parseEther("1"));
        const monthlyVestedAmount = amount.sub(initialAmount).div(vestingDuration);

        for (let i = 0; i <= vestingDuration.toNumber(); i += 1) {
          let claimable = initialAmount.add(monthlyVestedAmount.mul(i));

          // After `vestingDuration` months, all tokens should be claimable. This
          // case is handled separately to avoid rounding errors.
          if (i === vestingDuration.toNumber()) {
            claimable = amount;
          }

          // Special case i === 0 is handled in the first test
          if (i !== 0) {
            await mineBlockWithTimestamp(epoch.add(cliff).add(month.mul(i)).toNumber());
            expect(await tokenSaleDistributor.totalClaimable(user.address))
              .to.equal(claimable);
          }

          await increaseTime(month.div(2).toNumber());
          expect(await tokenSaleDistributor.totalClaimable(user.address))
            .to.equal(claimable);
        }
      });

      it("all tokens are vested after vesting period", async function () {
        await mineBlockWithTimestamp(epoch.add(cliff).add(month.mul(vestingDuration)).add(month).toNumber());
        expect(await tokenSaleDistributor.totalClaimable(user.address)).to.equal(amount);
      });
    });

    describe("Claiming", function () {
      before(prepare);

      it("claiming does not transfer tokens before cliff", async function () {
        await tokenSaleDistributor.connect(user).claim();
        expect(await token.balanceOf(user.address)).to.equal(0);
      });

      it("claiming after cliff transfers cliff percentage tokens", async function () {
        await setNextBlockTimestamp(epoch.add(cliff).toNumber());
        await tokenSaleDistributor.connect(user).claim();
        expect(await token.balanceOf(user.address))
          .to.equal(amount.mul(cliffPercentage).div(parseEther("1")));
      });

      it("claiming updates claimed tokens", async function () {
        const [allocation] = await tokenSaleDistributor.getUserAllocations(user.address);
        expect(allocation.claimed).to.equal(amount.mul(cliffPercentage).div(parseEther("1")));
      });

      it("claiming multiple times has no effect", async function () {
        await tokenSaleDistributor.connect(user).claim();
        await increaseTime(100);
        await tokenSaleDistributor.connect(user).claim();

        const expectedAmount = amount.mul(cliffPercentage).div(parseEther("1"));

        const [allocation] = await tokenSaleDistributor.getUserAllocations(user.address);
        expect(allocation.claimed).to.equal(expectedAmount);
        expect(await token.balanceOf(user.address)).to.equal(expectedAmount);
      });

      it("transfers correct amount of tokens after each month", async function () {
        const initialAmount = amount.mul(cliffPercentage).div(parseEther("1"));
        const monthlyClaimAmount = amount.sub(initialAmount).div(vestingDuration);

        for (let i = 1; i <= vestingDuration.toNumber(); i += 1) {
          await increaseTime(month.toNumber());

          let expectedClaimAmount = monthlyClaimAmount;
          let expectedBalance = initialAmount.add(monthlyClaimAmount.mul(i));
          if (i === vestingDuration.toNumber()) {
            // Last claim takes care of rounding errors, thus the last claim can be
            // slightly larger than the other ones.
            expectedClaimAmount = amount.sub(initialAmount.add(monthlyClaimAmount.mul(i - 1)));
            expectedBalance = amount;
          }

          expect(await tokenSaleDistributor.totalClaimable(user.address))
            .to.equal(expectedClaimAmount);

          await tokenSaleDistributor.connect(user).claim();
          expect(await tokenSaleDistributor.totalClaimable(user.address))
            .to.equal(0);

          expect(await token.balanceOf(user.address)).to.equal(expectedBalance);
        }
      });
    });
  });

  describe("Multiple Allocations", function () {
    const baseEpoch = Math.floor(new Date().getTime() / 1000);
    const allocations = [
      {
        isLinear: false,
        epoch: BigNumber.from(baseEpoch),
        vestingDuration: BigNumber.from(12),
        cliff: BigNumber.from(0),
        cliffPercentage: BigNumber.from(0),
        amount: parseEther("10000"),
      },
      {
        isLinear: true,
        epoch: BigNumber.from(baseEpoch + 30 * 86400),
        vestingDuration: BigNumber.from(86400 * 180),
        cliff: BigNumber.from(0),
        cliffPercentage: BigNumber.from(20).mul(BigNumber.from(10).pow(16)),
        amount: parseEther("50000"),
      },
      {
        isLinear: false,
        epoch: BigNumber.from(baseEpoch + 14 * 86400),
        vestingDuration: BigNumber.from(24),
        cliff: BigNumber.from(86400 * 365),
        cliffPercentage: BigNumber.from(50).mul(BigNumber.from(10).pow(16)),
        amount: parseEther("12345"),
      },
    ]

    before(async function () {
      await resetHardhatNetwork();
      await deployTokenSaleDistributor();

      await tokenSaleDistributor.setAllocations(
        allocations.map(() => user.address),
        allocations.map(({ isLinear }) => isLinear),
        allocations.map(({ epoch }) => epoch),
        allocations.map(({ vestingDuration }) => vestingDuration),
        allocations.map(({ cliff }) => cliff),
        allocations.map(({ cliffPercentage }) => cliffPercentage),
        allocations.map(({ amount }) => amount),
      );
    });

    it("returns all allocations", async function () {
      expect(await tokenSaleDistributor.totalAllocations(user.address))
        .to.equal(allocations.length);

      const userAllocations = await tokenSaleDistributor.getUserAllocations(user.address);

      for (let i = 0; i < allocations.length; i += 1) {
        for (const [key, value] of Object.entries(allocations[i])) {
          // @ts-ignore
          expect(userAllocations[i][key]).to.equal(value);
        }
      }
    });

    it("total allocated", async function () {
      const expectedTotal = allocations.reduce((sum, { amount }) => sum.add(amount), BigNumber.from(0));
      expect(await tokenSaleDistributor.totalAllocated(user.address))
        .to.equal(expectedTotal);
    });

    it("handles multiple simultaneous allocations correctly", async function () {
      // Zero vested tokens one day into the deployment.
      await increaseTime(86400);
      await tokenSaleDistributor.connect(user).claim();
      expect(await token.balanceOf(user.address)).to.equal(0);

      // 40 days in, the first monthly unlock from allocation #0 and 10 days worth
      // of tokens from allocation #1 (including the cliff) should have been vested.
      await setNextBlockTimestamp(allocations[0].epoch.toNumber() + 86400 * 40);
      await tokenSaleDistributor.connect(user).claim();
      let allocation0Amount = allocations[0].amount.div(allocations[0].vestingDuration);
      const allocation1InitialAmount = allocations[1].amount
        .mul(allocations[1].cliffPercentage).div(parseEther("1"));
      let allocation1Amount = allocation1InitialAmount.add(
        allocations[1].amount
          .sub(allocation1InitialAmount)
          .mul(86400 * (40 - 30))
          .div(allocations[1].vestingDuration),
      );
      let expectedAmount = allocation0Amount.add(allocation1Amount);
      expect(await token.balanceOf(user.address)).to.equal(expectedAmount);

      // 95 days in, three monthly unlocks from allocation #0 and 65 days worth
      // of tokens from allocation #1 (including the cliff) should have been vested.
      await setNextBlockTimestamp(allocations[0].epoch.toNumber() + 86400 * 95);
      await tokenSaleDistributor.connect(user).claim();
      allocation0Amount = allocations[0].amount.div(allocations[0].vestingDuration).mul(3);
      allocation1Amount = allocation1InitialAmount.add(
        allocations[1].amount
          .sub(allocation1InitialAmount)
          .mul(86400 * (95 - 30))
          .div(allocations[1].vestingDuration),
      );
      expectedAmount = allocation0Amount.add(allocation1Amount);
      expect(await token.balanceOf(user.address)).to.equal(expectedAmount);

      // 220 days in, seven monthly unlocks from allocation #0 and all of allocation #0
      // should have been vested.
      await setNextBlockTimestamp(allocations[0].epoch.toNumber() + 86400 * 220);
      await tokenSaleDistributor.connect(user).claim();
      allocation0Amount = allocations[0].amount.div(allocations[0].vestingDuration).mul(7);
      allocation1Amount = allocations[1].amount;
      expectedAmount = allocation0Amount.add(allocation1Amount);
      expect(await token.balanceOf(user.address)).to.equal(expectedAmount);

      // 500 days in, all of allocations #0 and #1 should have been vested. 50 % of
      // allocation #2 (the cliff percentage) should have been vested along with three
      // months worth of monthly unlocks.
      await setNextBlockTimestamp(allocations[0].epoch.toNumber() + 86400 * 500);
      await tokenSaleDistributor.connect(user).claim();
      allocation0Amount = allocations[0].amount;
      const allocation2InitialAmount = allocations[2].amount
        .mul(allocations[2].cliffPercentage).div(parseEther("1"));
      const allocation2Amount = allocations[2].amount.sub(allocation2InitialAmount)
        .div(allocations[2].vestingDuration).mul(3)
        .add(allocation2InitialAmount);
      expectedAmount = allocation0Amount.add(allocation1Amount).add(allocation2Amount);
      expect(await token.balanceOf(user.address)).to.equal(expectedAmount);
    });
  });
});
