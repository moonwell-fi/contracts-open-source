const { expect } = require("chai");
const hre = require('hardhat');
const { time } = require('@openzeppelin/test-helpers');
const { upgrades, ethers } = hre;
const { utils, constants } = ethers;
const { parseEther } = utils;
const ERC20PresetFixedSupply = require('@openzeppelin/contracts/build/contracts/ERC20PresetFixedSupply.json');

const CooldownSeconds = 10; // Starts withdraw cooldown
const UnstakeWindowSeconds = 5; // Window to withdraw after cooldown elapsed
const DistributionDurationSeconds = 1000; // How long to distribute rewards
const EmissionPerSecond = "1"; // WELL per second reward rate

describe("StakedWell", function () {
  let owner, ecosystemReserve, ecosystemReserveController, emissionManager, user1, user2
  let well, stakedWell

  beforeEach(async function () {
    const [_owner, _emissionManager, _user1, _user2] = await ethers.getSigners();
    owner = _owner;
    emissionManager = _emissionManager;
    user1 = _user1;
    user2 = _user2;

    const ERC20 = await ethers.getContractFactory(ERC20PresetFixedSupply.abi, ERC20PresetFixedSupply.bytecode);
    well = await ERC20.deploy("Mock WELL", "WELL", parseEther("1000"), owner.address)

    const EcosystemReserveController = await ethers.getContractFactory('EcosystemReserveController');
    ecosystemReserveController = await EcosystemReserveController.deploy();

    const EcosystemReserve = await ethers.getContractFactory('EcosystemReserve');
    ecosystemReserve = await upgrades.deployProxy(
      EcosystemReserve,
      [
        ecosystemReserveController.address, // EcosystemReserveController
      ]
    );
    await ecosystemReserveController.setEcosystemReserve(ecosystemReserve.address);

    const StakedWell = await ethers.getContractFactory('StakedWell');
    stakedWell = await upgrades.deployProxy(
      StakedWell,
      [
        well.address, // Staked token
        well.address, // Reward token
        CooldownSeconds,
        UnstakeWindowSeconds,
        ecosystemReserve.address, // Ecosystem reserve
        emissionManager.address, // Emission Manager
        DistributionDurationSeconds,
        constants.AddressZero, // Governance, set to 0x0 for now, unused
      ]
    );
    const assetConfig = {
      emissionPerSecond: utils.parseEther(EmissionPerSecond),
      totalStaked: 0, // Genesis, 0 supply now
      underlyingAsset: stakedWell.address,
    }
    await stakedWell.connect(emissionManager).configureAssets([assetConfig]);

    // Setup
    await ecosystemReserveController.approve(well.address, stakedWell.address, parseEther("1000")); // Allows stkWELL to pull rewards
    await well.transfer(user1.address, parseEther("100"));
    await well.transfer(user2.address, parseEther("100"));
    well.connect(user1).approve(stakedWell.address, parseEther("9999"))
    well.connect(user2).approve(stakedWell.address, parseEther("9999"))
  });

  it("Initialize", async function () {
    expect(await stakedWell.name()).to.equal("Staked WELL");
    expect(await stakedWell.symbol()).to.equal("stkWELL");
    expect(await stakedWell.decimals()).to.equal(18);
  });

  it("Upgrade proxy", async function () {
    const StakedWellV2 = await ethers.getContractFactory('StakedWell');
    await upgrades.upgradeProxy(stakedWell.address, StakedWellV2);
  });

  it("Cannot re-initialize again", async function () {
    await expect(
      stakedWell.connect(user1).initialize(
        well.address, // Staked token
        well.address, // Reward token
        CooldownSeconds,
        UnstakeWindowSeconds,
        constants.AddressZero, // Ecosystem reserve
        constants.AddressZero, // Emission Manager
        DistributionDurationSeconds,
        constants.AddressZero, // Governance, set to 0x0 for now, unused
      )
    ).to.be.revertedWith('Initializable: contract is already initialized');
  });

  it("Stake", async function () {
    await expect(stakedWell.connect(user1).stake(constants.AddressZero, parseEther("10"))).to.be.revertedWith('STAKE_ZERO_ADDRESS');
    await stakedWell.connect(user1).stake(user1.address, parseEther("10"));
    await stakedWell.connect(user2).stake(user2.address, parseEther("15"));
    expect(await stakedWell.balanceOf(user1.address)).to.be.equal(parseEther("10"));
    expect(await stakedWell.balanceOf(user2.address)).to.be.equal(parseEther("15"));

    await stakedWell.connect(user1).stake(user1.address, parseEther("10"));
    await stakedWell.connect(user2).stake(user2.address, parseEther("15"));
    expect(await stakedWell.balanceOf(user1.address)).to.be.equal(parseEther("20"));
    expect(await stakedWell.balanceOf(user2.address)).to.be.equal(parseEther("30"));
  });

  it("Cooldown and Redeem", async function () {
    await expect(stakedWell.connect(user1).redeem(constants.AddressZero, parseEther("10"))).to.be.revertedWith('REDEEM_ZERO_ADDRESS');
    await expect(stakedWell.connect(user1).redeem(user1.address, 0)).to.be.revertedWith('INVALID_ZERO_AMOUNT');
    await expect(stakedWell.connect(user1).redeem(user1.address, parseEther("1"))).to.be.revertedWith('UNSTAKE_WINDOW_FINISHED');
    await expect(stakedWell.connect(user1).cooldown()).to.be.revertedWith('INVALID_BALANCE_ON_COOLDOWN');

    await stakedWell.connect(user1).stake(user1.address, parseEther("10"));
    expect(await well.balanceOf(user1.address)).to.be.equal(parseEther("90")); // 100 - 10 staked
    await expect(stakedWell.connect(user1).redeem(user1.address, parseEther("10"))).to.be.revertedWith("UNSTAKE_WINDOW_FINISHED");

    expect(await stakedWell.stakersCooldowns(user1.address)).to.be.equal(0);
    await stakedWell.connect(user1).cooldown(); // 10 cooldown
    expect(await stakedWell.stakersCooldowns(user1.address)).to.be.gt(0);

    await expect(stakedWell.connect(user1).redeem(user1.address, parseEther("10"))).to.be.revertedWith('INSUFFICIENT_COOLDOWN');
    await time.increase(10); // Exceeds cooldown
    await time.increase(5); // Exceeds unstake window
    await expect(stakedWell.connect(user1).redeem(user1.address, parseEther("10"))).to.be.revertedWith('UNSTAKE_WINDOW_FINISHED');

    await stakedWell.connect(user1).cooldown(); // 10 cooldown
    await time.increase(10); // Exceeds cooldown
    await stakedWell.connect(user1).redeem(user1.address, parseEther("10"));
    expect(await well.balanceOf(user1.address)).to.be.equal(parseEther("100")); // 100 + 10 redeemed
  });

  it("Claim Rewards", async function () {
    await well.transfer(ecosystemReserve.address, parseEther("500")); // Seed eco reserve with 500 WELL
    expect(await well.balanceOf(ecosystemReserve.address)).to.be.equal(parseEther("500"));

    await stakedWell.connect(user1).stake(user1.address, parseEther("10"));
    expect(await stakedWell.getTotalRewardsBalance(user1.address)).to.be.equal(0);

    // Time travel to accrue WELL,  (1 sec get 1 WELL)
    await time.increase(1);
    expect(await stakedWell.getTotalRewardsBalance(user1.address)).to.be.equal(parseEther("1"));
    await time.increase(5);
    expect(await stakedWell.getTotalRewardsBalance(user1.address)).to.be.equal(parseEther("6"));

    expect(await well.balanceOf(user1.address)).to.be.equal(parseEther("90")); // Initial 100 - 10 staked
    await stakedWell.connect(user1).claimRewards(user1.address, parseEther("7")); // 1 sec has passed, so 6 + 1
    expect(await well.balanceOf(user1.address)).to.be.equal(parseEther("97")); // 90 + 7
    expect(await well.balanceOf(ecosystemReserve.address)).to.be.equal(parseEther("493")); // 500 - 7
  })

  it("Set Emissions Manager - can change emissions manager", async function () {
    // GIVEN a StakedToken Contract with an emissions manager
    // WHEN the emissions manager is changed
    await stakedWell.connect(emissionManager).setEmissionsManager(user1.address)

    // THEN the emissions manager is updated.
    expect(await stakedWell.EMISSION_MANAGER()).to.be.equal(user1.address)
  })

  it("Set Emissions Manager - fails when not called by emissions manager", async function () {
    // GIVEN a StakedToken Contract with an emissions manager
    // WHEN the emissions manager is changed by someone other than the emissions manager
    // THEN the call is reverted.
    await expect(stakedWell.connect(user1).setEmissionsManager(user1.address)).to.be.revertedWith('ONLY_EMISSION_MANAGER');
  })
});
