const {
  avaxUnsigned,
  avaxMantissa,
  both
} = require('../Utils/Avalanche');

const {fastForward, makeQiToken} = require('../Utils/Benqi');

const factor = avaxMantissa(.02);

const reserves = avaxUnsigned(3e12);
const cash = avaxUnsigned(reserves.multipliedBy(2));
const reduction = avaxUnsigned(2e12);

describe('QiToken', function () {
  let root, accounts;
  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
  });

  describe('_setReserveFactorFresh', () => {
    let qiToken;
    beforeEach(async () => {
      qiToken = await makeQiToken();
    });

    it("rejects change by non-admin", async () => {
      expect(
        await send(qiToken, 'harnessSetReserveFactorFresh', [factor], {from: accounts[0]})
      ).toHaveTokenFailure('UNAUTHORIZED', 'SET_RESERVE_FACTOR_ADMIN_CHECK');
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(0);
    });

    it("rejects change if market not fresh", async () => {
      expect(await send(qiToken, 'harnessFastForward', [5])).toSucceed();
      expect(await send(qiToken, 'harnessSetReserveFactorFresh', [factor])).toHaveTokenFailure('MARKET_NOT_FRESH', 'SET_RESERVE_FACTOR_FRESH_CHECK');
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(0);
    });

    it("rejects newReserveFactor that descales to 1", async () => {
      expect(await send(qiToken, 'harnessSetReserveFactorFresh', [avaxMantissa(1.01)])).toHaveTokenFailure('BAD_INPUT', 'SET_RESERVE_FACTOR_BOUNDS_CHECK');
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(0);
    });

    it("accepts newReserveFactor in valid range and emits log", async () => {
      const result = await send(qiToken, 'harnessSetReserveFactorFresh', [factor])
      expect(result).toSucceed();
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(factor);
      expect(result).toHaveLog("NewReserveFactor", {
        oldReserveFactorMantissa: '0',
        newReserveFactorMantissa: factor.toString(),
      });
    });

    it("accepts a change back to zero", async () => {
      const result1 = await send(qiToken, 'harnessSetReserveFactorFresh', [factor]);
      const result2 = await send(qiToken, 'harnessSetReserveFactorFresh', [0]);
      expect(result1).toSucceed();
      expect(result2).toSucceed();
      expect(result2).toHaveLog("NewReserveFactor", {
        oldReserveFactorMantissa: factor.toString(),
        newReserveFactorMantissa: '0',
      });
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(0);
    });
  });

  describe('_setReserveFactor', () => {
    let qiToken;
    beforeEach(async () => {
      qiToken = await makeQiToken();
    });

    beforeEach(async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
      await send(qiToken, '_setReserveFactor', [0]);
    });

    it("emits a reserve factor failure if interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await fastForward(qiToken, 1);
      await expect(send(qiToken, '_setReserveFactor', [factor])).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(0);
    });

    it("returns error from setReserveFactorFresh without emitting any extra logs", async () => {
      const {reply, receipt} = await both(qiToken, '_setReserveFactor', [avaxMantissa(2)]);
      expect(reply).toHaveTokenError('BAD_INPUT');
      expect(receipt).toHaveTokenFailure('BAD_INPUT', 'SET_RESERVE_FACTOR_BOUNDS_CHECK');
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(0);
    });

    it("returns success from setReserveFactorFresh", async () => {
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(0);
      expect(await send(qiToken, 'harnessFastForward', [5])).toSucceed();
      expect(await send(qiToken, '_setReserveFactor', [factor])).toSucceed();
      expect(await call(qiToken, 'reserveFactorMantissa')).toEqualNumber(factor);
    });
  });

  describe("_reduceReservesFresh", () => {
    let qiToken;
    beforeEach(async () => {
      qiToken = await makeQiToken();
      expect(await send(qiToken, 'harnessSetTotalReserves', [reserves])).toSucceed();
      expect(
        await send(qiToken.underlying, 'harnessSetBalance', [qiToken._address, cash])
      ).toSucceed();
    });

    it("fails if called by non-admin", async () => {
      expect(
        await send(qiToken, 'harnessReduceReservesFresh', [reduction], {from: accounts[0]})
      ).toHaveTokenFailure('UNAUTHORIZED', 'REDUCE_RESERVES_ADMIN_CHECK');
      expect(await call(qiToken, 'totalReserves')).toEqualNumber(reserves);
    });

    it("fails if market not fresh", async () => {
      expect(await send(qiToken, 'harnessFastForward', [5])).toSucceed();
      expect(await send(qiToken, 'harnessReduceReservesFresh', [reduction])).toHaveTokenFailure('MARKET_NOT_FRESH', 'REDUCE_RESERVES_FRESH_CHECK');
      expect(await call(qiToken, 'totalReserves')).toEqualNumber(reserves);
    });

    it("fails if amount exceeds reserves", async () => {
      expect(await send(qiToken, 'harnessReduceReservesFresh', [reserves.plus(1)])).toHaveTokenFailure('BAD_INPUT', 'REDUCE_RESERVES_VALIDATION');
      expect(await call(qiToken, 'totalReserves')).toEqualNumber(reserves);
    });

    it("fails if amount exceeds available cash", async () => {
      const cashLessThanReserves = reserves.minus(2);
      await send(qiToken.underlying, 'harnessSetBalance', [qiToken._address, cashLessThanReserves]);
      expect(await send(qiToken, 'harnessReduceReservesFresh', [reserves])).toHaveTokenFailure('TOKEN_INSUFFICIENT_CASH', 'REDUCE_RESERVES_CASH_NOT_AVAILABLE');
      expect(await call(qiToken, 'totalReserves')).toEqualNumber(reserves);
    });

    it("increases admin balance and reduces reserves on success", async () => {
      const balance = avaxUnsigned(await call(qiToken.underlying, 'balanceOf', [root]));
      expect(await send(qiToken, 'harnessReduceReservesFresh', [reserves])).toSucceed();
      expect(await call(qiToken.underlying, 'balanceOf', [root])).toEqualNumber(balance.plus(reserves));
      expect(await call(qiToken, 'totalReserves')).toEqualNumber(0);
    });

    it("emits an event on success", async () => {
      const result = await send(qiToken, 'harnessReduceReservesFresh', [reserves]);
      expect(result).toHaveLog('ReservesReduced', {
        admin: root,
        reduceAmount: reserves.toString(),
        newTotalReserves: '0'
      });
    });
  });

  describe("_reduceReserves", () => {
    let qiToken;
    beforeEach(async () => {
      qiToken = await makeQiToken();
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
      expect(await send(qiToken, 'harnessSetTotalReserves', [reserves])).toSucceed();
      expect(
        await send(qiToken.underlying, 'harnessSetBalance', [qiToken._address, cash])
      ).toSucceed();
    });

    it("emits a reserve-reduction failure if interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await fastForward(qiToken, 1);
      await expect(send(qiToken, '_reduceReserves', [reduction])).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from _reduceReservesFresh without emitting any extra logs", async () => {
      const {reply, receipt} = await both(qiToken, 'harnessReduceReservesFresh', [reserves.plus(1)]);
      expect(reply).toHaveTokenError('BAD_INPUT');
      expect(receipt).toHaveTokenFailure('BAD_INPUT', 'REDUCE_RESERVES_VALIDATION');
    });

    it("returns success code from _reduceReservesFresh and reduces the correct amount", async () => {
      expect(await call(qiToken, 'totalReserves')).toEqualNumber(reserves);
      expect(await send(qiToken, 'harnessFastForward', [5])).toSucceed();
      expect(await send(qiToken, '_reduceReserves', [reduction])).toSucceed();
    });
  });
});
