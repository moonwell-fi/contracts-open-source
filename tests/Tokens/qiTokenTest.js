const {
  avaxUnsigned,
  avaxMantissa,
  UInt256Max
} = require('../Utils/Avalanche');

const {
  makeQiToken,
  setBorrowRate,
  pretendBorrow
} = require('../Utils/Benqi');

describe('QiToken', function () {
  let root, admin, accounts;
  beforeEach(async () => {
    [root, admin, ...accounts] = saddle.accounts;
  });

  describe('constructor', () => {
    it("fails when non erc-20 underlying", async () => {
      await expect(makeQiToken({ underlying: { _address: root } })).rejects.toRevert("revert");
    });

    it("fails when 0 initial exchange rate", async () => {
      await expect(makeQiToken({ exchangeRate: 0 })).rejects.toRevert("revert initial exchange rate must be greater than zero.");
    });

    it("succeeds with erc-20 underlying and non-zero exchange rate", async () => {
      const qiToken = await makeQiToken();
      expect(await call(qiToken, 'underlying')).toEqual(qiToken.underlying._address);
      expect(await call(qiToken, 'admin')).toEqual(root);
    });

    it("succeeds when setting admin to contructor argument", async () => {
      const qiToken = await makeQiToken({ admin: admin });
      expect(await call(qiToken, 'admin')).toEqual(admin);
    });
  });

  describe('name, symbol, decimals', () => {
    let qiToken;

    beforeEach(async () => {
      qiToken = await makeQiToken({ name: "QiToken Foo", symbol: "cFOO", decimals: 10 });
    });

    it('should return correct name', async () => {
      expect(await call(qiToken, 'name')).toEqual("QiToken Foo");
    });

    it('should return correct symbol', async () => {
      expect(await call(qiToken, 'symbol')).toEqual("cFOO");
    });

    it('should return correct decimals', async () => {
      expect(await call(qiToken, 'decimals')).toEqualNumber(10);
    });
  });

  describe('balanceOfUnderlying', () => {
    it("has an underlying balance", async () => {
      const qiToken = await makeQiToken({ supportMarket: true, exchangeRate: 2 });
      await send(qiToken, 'harnessSetBalance', [root, 100]);
      expect(await call(qiToken, 'balanceOfUnderlying', [root])).toEqualNumber(200);
    });
  });

  describe('borrowRatePerTimestamp', () => {
    it("has a borrow rate", async () => {
      const qiToken = await makeQiToken({ supportMarket: true, interestRateModelOpts: { kind: 'jump-rate', baseRate: .05, multiplier: 0.45, kink: 0.95, jump: 5 } });
      const perTimestamp = await call(qiToken, 'borrowRatePerTimestamp');
      expect(Math.abs(perTimestamp * 31536000 - 5e16)).toBeLessThanOrEqual(1e8);
    });
  });

  describe('supplyRatePerTimestamp', () => {
    it("returns 0 if there's no supply", async () => {
      const qiToken = await makeQiToken({ supportMarket: true, interestRateModelOpts: { kind: 'jump-rate', baseRate: .05, multiplier: 0.45, kink: 0.95, jump: 5 } });
      const perTimestamp = await call(qiToken, 'supplyRatePerTimestamp');
      await expect(perTimestamp).toEqualNumber(0);
    });

    it("has a supply rate", async () => {
      const baseRate = 0.05;
      const multiplier = 0.45;
      const kink = 0.95;
      const jump = 5 * multiplier;
      const qiToken = await makeQiToken({ supportMarket: true, interestRateModelOpts: { kind: 'jump-rate', baseRate, multiplier, kink, jump } });
      await send(qiToken, 'harnessSetReserveFactorFresh', [avaxMantissa(.01)]);
      await send(qiToken, 'harnessExchangeRateDetails', [1, 1, 0]);
      await send(qiToken, 'harnessSetExchangeRate', [avaxMantissa(1)]);
      // Full utilization (Over the kink so jump is included), 1% reserves
      const borrowRate = baseRate + multiplier * kink + jump * .05;
      const expectedSuplyRate = borrowRate * .99;

      const perTimestamp = await call(qiToken, 'supplyRatePerTimestamp');
      expect(Math.abs(perTimestamp * 31536000 - expectedSuplyRate * 1e18)).toBeLessThanOrEqual(1e8);
    });
  });

  describe("borrowBalanceCurrent", () => {
    let borrower;
    let qiToken;

    beforeEach(async () => {
      borrower = accounts[0];
      qiToken = await makeQiToken();
    });

    beforeEach(async () => {
      await setBorrowRate(qiToken, .001)
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
    });

    it("reverts if interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      // make sure we accrue interest
      await send(qiToken, 'harnessFastForward', [1]);
      await expect(send(qiToken, 'borrowBalanceCurrent', [borrower])).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns successful result from borrowBalanceStored with no interest", async () => {
      await setBorrowRate(qiToken, 0);
      await pretendBorrow(qiToken, borrower, 1, 1, 5e18);
      expect(await call(qiToken, 'borrowBalanceCurrent', [borrower])).toEqualNumber(5e18)
    });

    it("returns successful result from borrowBalanceCurrent with no interest", async () => {
      await setBorrowRate(qiToken, 0);
      await pretendBorrow(qiToken, borrower, 1, 3, 5e18);
      expect(await send(qiToken, 'harnessFastForward', [5])).toSucceed();
      expect(await call(qiToken, 'borrowBalanceCurrent', [borrower])).toEqualNumber(5e18 * 3)
    });
  });

  describe("borrowBalanceStored", () => {
    let borrower;
    let qiToken;

    beforeEach(async () => {
      borrower = accounts[0];
      qiToken = await makeQiToken({ comptrollerOpts: { kind: 'bool' } });
    });

    it("returns 0 for account with no borrows", async () => {
      expect(await call(qiToken, 'borrowBalanceStored', [borrower])).toEqualNumber(0)
    });

    it("returns stored principal when account and market indexes are the same", async () => {
      await pretendBorrow(qiToken, borrower, 1, 1, 5e18);
      expect(await call(qiToken, 'borrowBalanceStored', [borrower])).toEqualNumber(5e18);
    });

    it("returns calculated balance when market index is higher than account index", async () => {
      await pretendBorrow(qiToken, borrower, 1, 3, 5e18);
      expect(await call(qiToken, 'borrowBalanceStored', [borrower])).toEqualNumber(5e18 * 3);
    });

    it("has undefined behavior when market index is lower than account index", async () => {
      // The market index < account index should NEVER happen, so we don't test this case
    });

    it("reverts on overflow of principal", async () => {
      await pretendBorrow(qiToken, borrower, 1, 3, UInt256Max());
      await expect(call(qiToken, 'borrowBalanceStored', [borrower])).rejects.toRevert("revert borrowBalanceStored: borrowBalanceStoredInternal failed");
    });

    it("reverts on non-zero stored principal with zero account index", async () => {
      await pretendBorrow(qiToken, borrower, 0, 3, 5);
      await expect(call(qiToken, 'borrowBalanceStored', [borrower])).rejects.toRevert("revert borrowBalanceStored: borrowBalanceStoredInternal failed");
    });
  });

  describe('exchangeRateStored', () => {
    let qiToken, exchangeRate = 2;

    beforeEach(async () => {
      qiToken = await makeQiToken({ exchangeRate });
    });

    it("returns initial exchange rate with zero qiTokenSupply", async () => {
      const result = await call(qiToken, 'exchangeRateStored');
      expect(result).toEqualNumber(avaxMantissa(exchangeRate));
    });

    it("calculates with single qiTokenSupply and single total borrow", async () => {
      const qiTokenSupply = 1, totalBorrows = 1, totalReserves = 0;
      await send(qiToken, 'harnessExchangeRateDetails', [qiTokenSupply, totalBorrows, totalReserves]);
      const result = await call(qiToken, 'exchangeRateStored');
      expect(result).toEqualNumber(avaxMantissa(1));
    });

    it("calculates with qiTokenSupply and total borrows", async () => {
      const qiTokenSupply = 100e18, totalBorrows = 10e18, totalReserves = 0;
      await send(qiToken, 'harnessExchangeRateDetails', [qiTokenSupply, totalBorrows, totalReserves].map(avaxUnsigned));
      const result = await call(qiToken, 'exchangeRateStored');
      expect(result).toEqualNumber(avaxMantissa(.1));
    });

    it("calculates with cash and qiTokenSupply", async () => {
      const qiTokenSupply = 5e18, totalBorrows = 0, totalReserves = 0;
      expect(
        await send(qiToken.underlying, 'transfer', [qiToken._address, avaxMantissa(500)])
      ).toSucceed();
      await send(qiToken, 'harnessExchangeRateDetails', [qiTokenSupply, totalBorrows, totalReserves].map(avaxUnsigned));
      const result = await call(qiToken, 'exchangeRateStored');
      expect(result).toEqualNumber(avaxMantissa(100));
    });

    it("calculates with cash, borrows, reserves and qiTokenSupply", async () => {
      const qiTokenSupply = 500e18, totalBorrows = 500e18, totalReserves = 5e18;
      expect(
        await send(qiToken.underlying, 'transfer', [qiToken._address, avaxMantissa(500)])
      ).toSucceed();
      await send(qiToken, 'harnessExchangeRateDetails', [qiTokenSupply, totalBorrows, totalReserves].map(avaxUnsigned));
      const result = await call(qiToken, 'exchangeRateStored');
      expect(result).toEqualNumber(avaxMantissa(1.99));
    });
  });

  describe('getCash', () => {
    it("gets the cash", async () => {
      const qiToken = await makeQiToken();
      const result = await call(qiToken, 'getCash');
      expect(result).toEqualNumber(0);
    });
  });
});
