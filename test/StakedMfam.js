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
const EmissionPerSecond = "1"; // MFAM per second reward rate

describe("StakedMfam", function () {
  let owner, ecosystemReserve, ecosystemReserveController, emissionManager, user1, user2
  let mfam, stakedMfam
  
  beforeEach(async function () {
    const [_owner, _emissionManager, _user1, _user2] = await ethers.getSigners();
    owner = _owner;
    emissionManager = _emissionManager;
    user1 = _user1;
    user2 = _user2;

    const ERC20 = await ethers.getContractFactory(ERC20PresetFixedSupply.abi, ERC20PresetFixedSupply.bytecode);
    mfam = await ERC20.deploy("Mock MFAM", "MFAM", parseEther("1000"), owner.address)

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

    const StakedMfam = await ethers.getContractFactory('StakedMfam');
    stakedMfam = await upgrades.deployProxy(
      StakedMfam,
      [
        mfam.address, // Staked token
        mfam.address, // Reward token
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
      underlyingAsset: stakedMfam.address,
    }
    await stakedMfam.connect(emissionManager).configureAssets([assetConfig]);

    // Setup
    await ecosystemReserveController.approve(mfam.address, stakedMfam.address, parseEther("1000")); // Allows stkMFAM to pull rewards
    await mfam.transfer(user1.address, parseEther("100"));
    await mfam.transfer(user2.address, parseEther("100"));
    mfam.connect(user1).approve(stakedMfam.address, parseEther("9999"))
    mfam.connect(user2).approve(stakedMfam.address, parseEther("9999"))
  });

  it("Initialize", async function () {
    expect(await stakedMfam.name()).to.equal("Staked MFAM");
    expect(await stakedMfam.symbol()).to.equal("stkMFAM");
    expect(await stakedMfam.decimals()).to.equal(18);
  });

  it("Upgrade proxy", async function () {
    const StakedMfamV2 = await ethers.getContractFactory('StakedMfam');
    await upgrades.upgradeProxy(stakedMfam.address, StakedMfamV2);
  });

  it("Cannot re-initialize again", async function () {
    await expect(
      stakedMfam.connect(user1).initialize(
        mfam.address, // Staked token
        mfam.address, // Reward token
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
    await expect(stakedMfam.connect(user1).stake(constants.AddressZero, parseEther("10"))).to.be.revertedWith('STAKE_ZERO_ADDRESS');
    await stakedMfam.connect(user1).stake(user1.address, parseEther("10"));
    await stakedMfam.connect(user2).stake(user2.address, parseEther("15"));
    expect(await stakedMfam.balanceOf(user1.address)).to.be.equal(parseEther("10"));
    expect(await stakedMfam.balanceOf(user2.address)).to.be.equal(parseEther("15"));

    await stakedMfam.connect(user1).stake(user1.address, parseEther("10"));
    await stakedMfam.connect(user2).stake(user2.address, parseEther("15"));
    expect(await stakedMfam.balanceOf(user1.address)).to.be.equal(parseEther("20"));
    expect(await stakedMfam.balanceOf(user2.address)).to.be.equal(parseEther("30"));
  });

  it("Cooldown and Redeem", async function () {
    await expect(stakedMfam.connect(user1).redeem(constants.AddressZero, parseEther("10"))).to.be.revertedWith('REDEEM_ZERO_ADDRESS');
    await expect(stakedMfam.connect(user1).redeem(user1.address, 0)).to.be.revertedWith('INVALID_ZERO_AMOUNT');
    await expect(stakedMfam.connect(user1).redeem(user1.address, parseEther("1"))).to.be.revertedWith('UNSTAKE_WINDOW_FINISHED');
    await expect(stakedMfam.connect(user1).cooldown()).to.be.revertedWith('INVALID_BALANCE_ON_COOLDOWN');

    await stakedMfam.connect(user1).stake(user1.address, parseEther("10"));
    expect(await mfam.balanceOf(user1.address)).to.be.equal(parseEther("90")); // 100 - 10 staked
    
    expect(await stakedMfam.stakersCooldowns(user1.address)).to.be.equal(0);
    await stakedMfam.connect(user1).cooldown(); // 10 cooldown
    expect(await stakedMfam.stakersCooldowns(user1.address)).to.be.gt(0);

    await expect(stakedMfam.connect(user1).redeem(user1.address, parseEther("10"))).to.be.revertedWith('INSUFFICIENT_COOLDOWN');
    await time.increase(10); // Exceeds cooldown
    await time.increase(5); // Exceeds unstake window
    await expect(stakedMfam.connect(user1).redeem(user1.address, parseEther("10"))).to.be.revertedWith('UNSTAKE_WINDOW_FINISHED');

    await stakedMfam.connect(user1).cooldown(); // 10 cooldown
    await time.increase(10); // Exceeds cooldown
    await stakedMfam.connect(user1).redeem(user1.address, parseEther("10"));
    expect(await mfam.balanceOf(user1.address)).to.be.equal(parseEther("100")); // 100 + 10 redeemed
  });

  it("Claim Rewards", async function () {
    await mfam.transfer(ecosystemReserve.address, parseEther("500")); // Seed eco reserve with 500 MFAM
    expect(await mfam.balanceOf(ecosystemReserve.address)).to.be.equal(parseEther("500"));

    await stakedMfam.connect(user1).stake(user1.address, parseEther("10"));
    expect(await stakedMfam.getTotalRewardsBalance(user1.address)).to.be.equal(0);

    // Time travel to accrue MFAM,  (1 sec get 1 MFAM)
    await time.increase(1);
    expect(await stakedMfam.getTotalRewardsBalance(user1.address)).to.be.equal(parseEther("1"));
    await time.increase(5);
    expect(await stakedMfam.getTotalRewardsBalance(user1.address)).to.be.equal(parseEther("6"));

    expect(await mfam.balanceOf(user1.address)).to.be.equal(parseEther("90")); // Initial 100 - 10 staked
    await stakedMfam.connect(user1).claimRewards(user1.address, parseEther("7")); // 1 sec has passed, so 6 + 1
    expect(await mfam.balanceOf(user1.address)).to.be.equal(parseEther("97")); // 90 + 7
    expect(await mfam.balanceOf(ecosystemReserve.address)).to.be.equal(parseEther("493")); // 500 - 7
  })
});
