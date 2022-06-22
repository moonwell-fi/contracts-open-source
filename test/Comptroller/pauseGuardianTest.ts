import { address, call, deploy, send } from '../utils';
import { Signer, BigNumber } from "ethers";
import { expect } from "chai";
const hre = require('hardhat')
import chai from "chai";
import { solidity } from "ethereum-waffle";

chai.use(solidity);

describe('Comptroller', () => {
  // Root is the initial admin of the contract.
  let root: Signer

  // An array of other accounts, which are not initially admins.
  let accounts: Array<Signer>

  // The comptroller contract under test.
  let comptroller: any

  beforeEach(async () => {
    [root, ...accounts] = await hre.ethers.getSigners();
  });

  describe("_setPauseGuardian", () => {
    beforeEach(async () => {
      comptroller = await deploy('Comptroller');
    });

    describe("failing", () => {
      // TODO(lunar-engineering): Enable this test when we can detect failure logs in the comptroller.
      // it("emits a failure log if not sent by admin", async () => {
      //   let result = await send(comptroller, '_setPauseGuardian', [root], { from: accounts[1] });
      //   expect(result).toHaveTrollFailure('UNAUTHORIZED', 'SET_PAUSE_GUARDIAN_OWNER_CHECK');
      // });

      it("does not change the pause guardian", async () => {
        let pauseGuardian = await call(comptroller, 'pauseGuardian');
        expect(pauseGuardian).to.equal(address(0));
        await send(comptroller, '_setPauseGuardian', [await root.getAddress()], { from: accounts[1] });

        pauseGuardian = await call(comptroller, 'pauseGuardian');
        expect(pauseGuardian).to.equal(address(0));
      });
    });


    describe('succesfully changing pause guardian', () => {
      let result;

      beforeEach(async () => {
        comptroller = await deploy('Comptroller');

        result = await send(comptroller, '_setPauseGuardian', [await accounts[1].getAddress()]);
      });

      // TODO(lunar-engineering): Enable this when we can detect event emission.
      // it('emits new pause guardian event', async () => {
      //   expect(result).toHaveLog(
      //     'NewPauseGuardian',
      //     { newPauseGuardian: accounts[1], oldPauseGuardian: address(0) }
      //   );
      // });

      it('changes pending pause guardian', async () => {
        let pauseGuardian = await call(comptroller, 'pauseGuardian');
        expect(pauseGuardian).to.equal(await accounts[1].getAddress());
      });
    });
  });

  describe('setting paused', () => {
    beforeEach(async () => {
      comptroller = await deploy('Comptroller');
    });

    let globalMethods = ["Transfer", "Seize"];
    describe('succeeding', () => {
      let pauseGuardian: Signer

      beforeEach(async () => {
        pauseGuardian = accounts[1];
        await send(comptroller, '_setPauseGuardian', [await pauseGuardian.getAddress()], { from: root });
      });

      globalMethods.forEach(async (method) => {
        it(`only pause guardian or admin can pause ${method}`, async () => {
          await expect(send(comptroller, `_set${method}Paused`, [true], { from: accounts[2] })).to.be.revertedWith("only pause guardian and admin can pause");
          await expect(send(comptroller, `_set${method}Paused`, [false], { from: accounts[2] })).to.be.revertedWith("only pause guardian and admin can pause");
        });

        it(`PauseGuardian can pause of ${method}GuardianPaused`, async () => {
          let result = await send(comptroller, `_set${method}Paused`, [true], { from: pauseGuardian });
          // TODO(lunar-engineering): Enable this test when we can detect event logs
          // expect(result).toHaveLog(`ActionPaused`, { action: method, pauseState: true });

          let camelCase = method.charAt(0).toLowerCase() + method.substring(1);

          let state = await call(comptroller, `${camelCase}GuardianPaused`);
          expect(state).to.equal(true);

          await expect(send(comptroller, `_set${method}Paused`, [false], { from: pauseGuardian })).to.be.revertedWith("only admin can unpause");
          result = await send(comptroller, `_set${method}Paused`, [false]);

          // TODO(lunar-engineering): Enable this test when we can detect event logs
          // expect(result).toHaveLog(`ActionPaused`, { action: method, pauseState: false });

          state = await call(comptroller, `${camelCase}GuardianPaused`);
          expect(state).to.equal(false);
        });

        it(`pauses ${method}`, async () => {
          await send(comptroller, `_set${method}Paused`, [true], { from: pauseGuardian });
          switch (method) {
            case "Transfer":
              await expect(
                send(comptroller, 'transferAllowed', [address(1), address(2), address(3), 1])
              ).to.be.revertedWith(`${method.toLowerCase()} is paused`);
              break;

            case "Seize":
              await expect(
                send(comptroller, 'seizeAllowed', [address(1), address(2), address(3), address(4), 1])
              ).to.be.revertedWith(`${method.toLowerCase()} is paused`);
              break;

            default:
              break;
          }
        });
      });
    });

    let marketMethods = ["Borrow", "Mint"];
    describe('succeeding', () => {
      let pauseGuardian: Signer
      let mToken: any

      beforeEach(async () => {
        pauseGuardian = accounts[1];

        // TODO(lunar): This should probably get refactored into a method that just makes us a comptroller.

        // Deploy a test token
        const tokenDecimals = "6"
        const token = await deploy("FaucetToken", [
          BigNumber.from("0"), // Initial amount
          "Test Token",
          BigNumber.from(tokenDecimals), // Decimals
          "TEST"
        ])

        // Deploy an interest rate model
        const interestRateModel = await deploy("JumpRateModel", [
          BigNumber.from("20000000000000000"), // Base rate per year
          BigNumber.from("100000000000000000"), // Multiplier per year
          BigNumber.from("1090000000000000000"), // Jump multiplier per year
          BigNumber.from("800000000000000000"), // Model Kink
        ])

        // Deploy a market
        const mTokenImplementation = await deploy("MErc20Delegate")
        mToken = await deploy("MErc20Delegator", [
          token.address,
          comptroller.address,
          interestRateModel.address,
          BigNumber.from("10").pow(tokenDecimals + 8).mul("2"),
          "M Test Token",
          "mTest",
          BigNumber.from("8"),
          await root.getAddress(),
          mTokenImplementation.address,
          "0x00",
        ])

        // Configure market in the comptroller
        await send(comptroller, '_supportMarket', [mToken.address])

        // Set up a pause guardian
        await send(comptroller, '_setPauseGuardian', [await accounts[1].getAddress()], { from: root });
      });

      marketMethods.forEach(async (method) => {
        it(`only pause guardian or admin can pause ${method}`, async () => {
          await expect(send(comptroller, `_set${method}Paused`, [mToken.address, true], { from: accounts[2] })).to.be.revertedWith("only pause guardian and admin can pause");
          await expect(send(comptroller, `_set${method}Paused`, [mToken.address, false], { from: accounts[2] })).to.be.revertedWith("only pause guardian and admin can pause");
        });

        it(`PauseGuardian can pause of ${method}GuardianPaused`, async () => {
          let result = await send(comptroller, `_set${method}Paused`, [mToken.address, true], { from: pauseGuardian });
          // TODO(lunar-engineering): Enable this test when we can detect event logs
          // expect(result).toHaveLog(`ActionPaused`, { qiToken: qiToken._address, action: method, pauseState: true });

          let camelCase = method.charAt(0).toLowerCase() + method.substring(1);

          let state = await call(comptroller, `${camelCase}GuardianPaused`, [mToken.address]);
          expect(state).to.equal(true);

          await expect(send(comptroller, `_set${method}Paused`, [mToken.address, false], { from: pauseGuardian })).to.be.revertedWith("only admin can unpause");
          result = await send(comptroller, `_set${method}Paused`, [mToken.address, false]);

          // TODO(lunar-engineering): Enable this test when we can detect event logs
          // expect(result).toHaveLog(`ActionPaused`, { qiToken: qiToken._address, action: method, pauseState: false });

          state = await call(comptroller, `${camelCase}GuardianPaused`, [mToken.address]);
          expect(state).to.equal(false);
        });

        it(`pauses ${method}`, async () => {
          await send(comptroller, `_set${method}Paused`, [mToken.address, true], { from: pauseGuardian });
          switch (method) {
            case "Mint":
              // TODO(lunar-engineering): Enable this test when we can detect event logs
              // expect(await call(comptroller, 'mintAllowed', [address(1), address(2), 1])).toHaveTrollError('MARKET_NOT_LISTED');
              await expect(send(comptroller, 'mintAllowed', [mToken.address, address(2), 1])).to.be.revertedWith(`${method.toLowerCase()} is paused`);
              break;

            case "Borrow":
              // TODO(lunar-engineering): Enable this test when we can detect event logs
              // expect(await call(comptroller, 'borrowAllowed', [address(1), address(2), 1])).toHaveTrollError('MARKET_NOT_LISTED');
              await expect(send(comptroller, 'borrowAllowed', [mToken.address, address(2), 1])).to.be.revertedWith(`${method.toLowerCase()} is paused`);
              break;

            default:
              break;
          }
        });
      });
    });
  });
});
