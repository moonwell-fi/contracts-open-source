const {
  avaxGasCost,
  avaxUnsigned,
  UInt256Max
} = require('../Utils/Avalanche');

const {
  makeQiToken,
  fastForward,
  setBalance,
  getBalances,
  adjustBalances,
  pretendBorrow,
  preApprove
} = require('../Utils/Benqi');

const repayAmount = avaxUnsigned(10e2);
const seizeAmount = repayAmount;
const seizeTokens = seizeAmount.multipliedBy(4); // forced

async function preLiquidate(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral) {
  // setup for success in liquidating
  await send(qiToken.comptroller, 'setLiquidateBorrowAllowed', [true]);
  await send(qiToken.comptroller, 'setLiquidateBorrowVerify', [true]);
  await send(qiToken.comptroller, 'setRepayBorrowAllowed', [true]);
  await send(qiToken.comptroller, 'setRepayBorrowVerify', [true]);
  await send(qiToken.comptroller, 'setSeizeAllowed', [true]);
  await send(qiToken.comptroller, 'setSeizeVerify', [true]);
  await send(qiToken.comptroller, 'setFailCalculateSeizeTokens', [false]);
  await send(qiToken.underlying, 'harnessSetFailTransferFromAddress', [liquidator, false]);
  await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiTokenCollateral.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiTokenCollateral.comptroller, 'setCalculatedSeizeTokens', [seizeTokens]);
  await setBalance(qiTokenCollateral, liquidator, 0);
  await setBalance(qiTokenCollateral, borrower, seizeTokens);
  await pretendBorrow(qiTokenCollateral, borrower, 0, 1, 0);
  await pretendBorrow(qiToken, borrower, 1, 1, repayAmount);
  await preApprove(qiToken, liquidator, repayAmount);
}

async function liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral) {
  return send(qiToken, 'harnessLiquidateBorrowFresh', [liquidator, borrower, repayAmount, qiTokenCollateral._address]);
}

async function liquidate(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral) {
  // make sure to have a block delta so we accrue interest
  await fastForward(qiToken, 1);
  await fastForward(qiTokenCollateral, 1);
  return send(qiToken, 'liquidateBorrow', [borrower, repayAmount, qiTokenCollateral._address], {from: liquidator});
}

async function seize(qiToken, liquidator, borrower, seizeAmount) {
  return send(qiToken, 'seize', [liquidator, borrower, seizeAmount]);
}

describe('QiToken', function () {
  let root, liquidator, borrower, accounts;
  let qiToken, qiTokenCollateral;

  beforeEach(async () => {
    [root, liquidator, borrower, ...accounts] = saddle.accounts;
    qiToken = await makeQiToken({comptrollerOpts: {kind: 'bool'}});
    qiTokenCollateral = await makeQiToken({comptroller: qiToken.comptroller});
  });

  beforeEach(async () => {
    await preLiquidate(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral);
  });

  describe('liquidateBorrowFresh', () => {
    it("fails if comptroller tells it to", async () => {
      await send(qiToken.comptroller, 'setLiquidateBorrowAllowed', [false]);
      expect(
        await liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)
      ).toHaveTrollReject('LIQUIDATE_COMPTROLLER_REJECTION', 'MATH_ERROR');
    });

    it("proceeds if comptroller tells it to", async () => {
      expect(
        await liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)
      ).toSucceed();
    });

    it("fails if market not fresh", async () => {
      await fastForward(qiToken);
      expect(
        await liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)
      ).toHaveTokenFailure('MARKET_NOT_FRESH', 'LIQUIDATE_FRESHNESS_CHECK');
    });

    it("fails if collateral market not fresh", async () => {
      await fastForward(qiToken);
      await fastForward(qiTokenCollateral);
      await send(qiToken, 'accrueInterest');
      expect(
        await liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)
      ).toHaveTokenFailure('MARKET_NOT_FRESH', 'LIQUIDATE_COLLATERAL_FRESHNESS_CHECK');
    });

    it("fails if borrower is equal to liquidator", async () => {
      expect(
        await liquidateFresh(qiToken, borrower, borrower, repayAmount, qiTokenCollateral)
      ).toHaveTokenFailure('INVALID_ACCOUNT_PAIR', 'LIQUIDATE_LIQUIDATOR_IS_BORROWER');
    });

    it("fails if repayAmount = 0", async () => {
      expect(await liquidateFresh(qiToken, liquidator, borrower, 0, qiTokenCollateral)).toHaveTokenFailure('INVALID_CLOSE_AMOUNT_REQUESTED', 'LIQUIDATE_CLOSE_AMOUNT_IS_ZERO');
    });

    it("fails if calculating seize tokens fails and does not adjust balances", async () => {
      const beforeBalances = await getBalances([qiToken, qiTokenCollateral], [liquidator, borrower]);
      await send(qiToken.comptroller, 'setFailCalculateSeizeTokens', [true]);
      await expect(
        liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)
      ).rejects.toRevert('revert LIQUIDATE_COMPTROLLER_CALCULATE_AMOUNT_SEIZE_FAILED');
      const afterBalances = await getBalances([qiToken, qiTokenCollateral], [liquidator, borrower]);
      expect(afterBalances).toEqual(beforeBalances);
    });

    it("fails if repay fails", async () => {
      await send(qiToken.comptroller, 'setRepayBorrowAllowed', [false]);
      expect(
        await liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)
      ).toHaveTrollReject('LIQUIDATE_REPAY_BORROW_FRESH_FAILED');
    });

    it("reverts if seize fails", async () => {
      await send(qiToken.comptroller, 'setSeizeAllowed', [false]);
      await expect(
        liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)
      ).rejects.toRevert("revert token seizure failed");
    });

    xit("reverts if liquidateBorrowVerify fails", async() => {
      await send(qiToken.comptroller, 'setLiquidateBorrowVerify', [false]);
      await expect(
        liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)
      ).rejects.toRevert("revert liquidateBorrowVerify rejected liquidateBorrow");
    });

    it("transfers the cash, borrows, tokens, and emits Transfer, LiquidateBorrow events", async () => {
      const beforeBalances = await getBalances([qiToken, qiTokenCollateral], [liquidator, borrower]);
      const result = await liquidateFresh(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral);
      const afterBalances = await getBalances([qiToken, qiTokenCollateral], [liquidator, borrower]);
      expect(result).toSucceed();
      expect(result).toHaveLog('LiquidateBorrow', {
        liquidator: liquidator,
        borrower: borrower,
        repayAmount: repayAmount.toString(),
        qiTokenCollateral: qiTokenCollateral._address,
        seizeTokens: seizeTokens.toString()
      });
      expect(result).toHaveLog(['Transfer', 0], {
        from: liquidator,
        to: qiToken._address,
        amount: repayAmount.toString()
      });
      expect(result).toHaveLog(['Transfer', 1], {
        from: borrower,
        to: liquidator,
        amount: seizeTokens.toString()
      });
      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [qiToken, 'cash', repayAmount],
        [qiToken, 'borrows', -repayAmount],
        [qiToken, liquidator, 'cash', -repayAmount],
        [qiTokenCollateral, liquidator, 'tokens', seizeTokens],
        [qiToken, borrower, 'borrows', -repayAmount],
        [qiTokenCollateral, borrower, 'tokens', -seizeTokens]
      ]));
    });
  });

  describe('liquidateBorrow', () => {
    it("emits a liquidation failure if borrowed asset interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(liquidate(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("emits a liquidation failure if collateral asset interest accrual fails", async () => {
      await send(qiTokenCollateral.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(liquidate(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from liquidateBorrowFresh without emitting any extra logs", async () => {
      expect(await liquidate(qiToken, liquidator, borrower, 0, qiTokenCollateral)).toHaveTokenFailure('INVALID_CLOSE_AMOUNT_REQUESTED', 'LIQUIDATE_CLOSE_AMOUNT_IS_ZERO');
    });

    it("returns success from liquidateBorrowFresh and transfers the correct amounts", async () => {
      const beforeBalances = await getBalances([qiToken, qiTokenCollateral], [liquidator, borrower]);
      const result = await liquidate(qiToken, liquidator, borrower, repayAmount, qiTokenCollateral);
      const gasCost = await avaxGasCost(result);
      const afterBalances = await getBalances([qiToken, qiTokenCollateral], [liquidator, borrower]);
      expect(result).toSucceed();
      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [qiToken, 'cash', repayAmount],
        [qiToken, 'borrows', -repayAmount],
        [qiToken, liquidator, 'eth', -gasCost],
        [qiToken, liquidator, 'cash', -repayAmount],
        [qiTokenCollateral, liquidator, 'eth', -gasCost],
        [qiTokenCollateral, liquidator, 'tokens', seizeTokens],
        [qiToken, borrower, 'borrows', -repayAmount],
        [qiTokenCollateral, borrower, 'tokens', -seizeTokens]
      ]));
    });
  });

  describe('seize', () => {
    // XXX verify callers are properly checked

    it("fails if seize is not allowed", async () => {
      await send(qiToken.comptroller, 'setSeizeAllowed', [false]);
      expect(await seize(qiTokenCollateral, liquidator, borrower, seizeTokens)).toHaveTrollReject('LIQUIDATE_SEIZE_COMPTROLLER_REJECTION', 'MATH_ERROR');
    });

    it("fails if qiTokenBalances[borrower] < amount", async () => {
      await setBalance(qiTokenCollateral, borrower, 1);
      expect(await seize(qiTokenCollateral, liquidator, borrower, seizeTokens)).toHaveTokenMathFailure('LIQUIDATE_SEIZE_BALANCE_DECREMENT_FAILED', 'INTEGER_UNDERFLOW');
    });

    it("fails if qiTokenBalances[liquidator] overflows", async () => {
      await setBalance(qiTokenCollateral, liquidator, UInt256Max());
      expect(await seize(qiTokenCollateral, liquidator, borrower, seizeTokens)).toHaveTokenMathFailure('LIQUIDATE_SEIZE_BALANCE_INCREMENT_FAILED', 'INTEGER_OVERFLOW');
    });

    it("succeeds, updates balances, and emits Transfer event", async () => {
      const beforeBalances = await getBalances([qiTokenCollateral], [liquidator, borrower]);
      const result = await seize(qiTokenCollateral, liquidator, borrower, seizeTokens);
      const afterBalances = await getBalances([qiTokenCollateral], [liquidator, borrower]);
      expect(result).toSucceed();
      expect(result).toHaveLog('Transfer', {
        from: borrower,
        to: liquidator,
        amount: seizeTokens.toString()
      });
      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [qiTokenCollateral, liquidator, 'tokens', seizeTokens],
        [qiTokenCollateral, borrower, 'tokens', -seizeTokens]
      ]));
    });
  });
});
