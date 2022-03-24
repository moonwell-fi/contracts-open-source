const {
  avaxMantissa,
  avaxUnsigned,
  UInt256Max
} = require('../Utils/Avalanche');
const {
  makeQiToken,
  setBorrowRate
} = require('../Utils/Benqi');

const blockTimestamp = 2e7;
const borrowIndex = 1e18;
const borrowRate = .000001;

async function pretendBlock(qiToken, accrualBlock = blockTimestamp, deltaTimestamps = 1) {
  await send(qiToken, 'harnessSetAccrualBlockTimestamp', [avaxUnsigned(blockTimestamp)]);
  await send(qiToken, 'harnessSetBlockTimestamp', [avaxUnsigned(blockTimestamp + deltaTimestamps)]);
  await send(qiToken, 'harnessSetBorrowIndex', [avaxUnsigned(borrowIndex)]);
}

async function preAccrue(qiToken) {
  await setBorrowRate(qiToken, borrowRate);
  await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiToken, 'harnessExchangeRateDetails', [0, 0, 0]);
}

describe('QiToken', () => {
  let root, accounts;
  let qiToken;
  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
    qiToken = await makeQiToken({comptrollerOpts: {kind: 'bool'}});
  });

  beforeEach(async () => {
    await preAccrue(qiToken);
  });

  describe('accrueInterest', () => {
    it('reverts if the interest rate is absurdly high', async () => {
      await pretendBlock(qiToken, blockTimestamp, 1);
      expect(await call(qiToken, 'getBorrowRateMaxMantissa')).toEqualNumber(avaxMantissa(0.000005)); // 0.0005% per timestmp
      await setBorrowRate(qiToken, 0.001e-2); // 0.0010% per timestmp
      await expect(send(qiToken, 'accrueInterest')).rejects.toRevert("revert borrow rate is absurdly high");
    });

    it('fails if new borrow rate calculation fails', async () => {
      await pretendBlock(qiToken, blockTimestamp, 1);
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(send(qiToken, 'accrueInterest')).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it('fails if simple interest factor calculation fails', async () => {
      await pretendBlock(qiToken, blockTimestamp, 5e70);
      expect(await send(qiToken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_SIMPLE_INTEREST_FACTOR_CALCULATION_FAILED');
    });

    it('fails if new borrow index calculation fails', async () => {
      await pretendBlock(qiToken, blockTimestamp, 5e60);
      expect(await send(qiToken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_BORROW_INDEX_CALCULATION_FAILED');
    });

    it('fails if new borrow interest index calculation fails', async () => {
      await pretendBlock(qiToken)
      await send(qiToken, 'harnessSetBorrowIndex', [UInt256Max()]);
      expect(await send(qiToken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_BORROW_INDEX_CALCULATION_FAILED');
    });

    it('fails if interest accumulated calculation fails', async () => {
      await send(qiToken, 'harnessExchangeRateDetails', [0, UInt256Max(), 0]);
      await pretendBlock(qiToken)
      expect(await send(qiToken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_ACCUMULATED_INTEREST_CALCULATION_FAILED');
    });

    it('fails if new total borrows calculation fails', async () => {
      await setBorrowRate(qiToken, 1e-18);
      await pretendBlock(qiToken)
      await send(qiToken, 'harnessExchangeRateDetails', [0, UInt256Max(), 0]);
      expect(await send(qiToken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_TOTAL_BORROWS_CALCULATION_FAILED');
    });

    it('fails if interest accumulated for reserves calculation fails', async () => {
      await setBorrowRate(qiToken, .000001);
      await send(qiToken, 'harnessExchangeRateDetails', [0, avaxUnsigned(1e30), UInt256Max()]);
      await send(qiToken, 'harnessSetReserveFactorFresh', [avaxUnsigned(1e10)]);
      await pretendBlock(qiToken, blockTimestamp, 5e20)
      expect(await send(qiToken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_TOTAL_RESERVES_CALCULATION_FAILED');
    });

    it('fails if new total reserves calculation fails', async () => {
      await setBorrowRate(qiToken, 1e-18);
      await send(qiToken, 'harnessExchangeRateDetails', [0, avaxUnsigned(1e56), UInt256Max()]);
      await send(qiToken, 'harnessSetReserveFactorFresh', [avaxUnsigned(1e17)]);
      await pretendBlock(qiToken)
      expect(await send(qiToken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_TOTAL_RESERVES_CALCULATION_FAILED');
    });

    it('succeeds and saves updated values in storage on success', async () => {
      const startingTotalBorrows = 1e22;
      const startingTotalReserves = 1e20;
      const reserveFactor = 1e17;

      await send(qiToken, 'harnessExchangeRateDetails', [0, avaxUnsigned(startingTotalBorrows), avaxUnsigned(startingTotalReserves)]);
      await send(qiToken, 'harnessSetReserveFactorFresh', [avaxUnsigned(reserveFactor)]);
      await pretendBlock(qiToken)

      const expectedAccrualBlockTimestamp = blockTimestamp + 1;
      const expectedBorrowIndex = borrowIndex + borrowIndex * borrowRate;
      const expectedTotalBorrows = startingTotalBorrows + startingTotalBorrows * borrowRate;
      const expectedTotalReserves = startingTotalReserves + startingTotalBorrows *  borrowRate * reserveFactor / 1e18;

      const receipt = await send(qiToken, 'accrueInterest')
      expect(receipt).toSucceed();
      expect(receipt).toHaveLog('AccrueInterest', {
        cashPrior: 0,
        interestAccumulated: avaxUnsigned(expectedTotalBorrows).minus(avaxUnsigned(startingTotalBorrows)).toFixed(),
        borrowIndex: avaxUnsigned(expectedBorrowIndex).toFixed(),
        totalBorrows: avaxUnsigned(expectedTotalBorrows).toFixed()
      })
      expect(await call(qiToken, 'accrualBlockTimestamp')).toEqualNumber(expectedAccrualBlockTimestamp);
      expect(await call(qiToken, 'borrowIndex')).toEqualNumber(expectedBorrowIndex);
      expect(await call(qiToken, 'totalBorrows')).toEqualNumber(expectedTotalBorrows);
      expect(await call(qiToken, 'totalReserves')).toEqualNumber(expectedTotalReserves);
    });
  });
});
