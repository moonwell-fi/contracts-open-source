const {
  avaxUnsigned,
  avaxMantissa,
  UInt256Max
} = require('../Utils/Avalanche');

const {
  makeQiToken,
  balanceOf,
  borrowSnapshot,
  totalBorrows,
  fastForward,
  setBalance,
  preApprove,
  pretendBorrow
} = require('../Utils/Benqi');

const borrowAmount = avaxUnsigned(10e3);
const repayAmount = avaxUnsigned(10e2);

async function preBorrow(qiToken, borrower, borrowAmount) {
  await send(qiToken.comptroller, 'setBorrowAllowed', [true]);
  await send(qiToken.comptroller, 'setBorrowVerify', [true]);
  await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiToken.underlying, 'harnessSetBalance', [qiToken._address, borrowAmount]);
  await send(qiToken, 'harnessSetFailTransferToAddress', [borrower, false]);
  await send(qiToken, 'harnessSetAccountBorrows', [borrower, 0, 0]);
  await send(qiToken, 'harnessSetTotalBorrows', [0]);
}

async function borrowFresh(qiToken, borrower, borrowAmount) {
  return send(qiToken, 'harnessBorrowFresh', [borrower, borrowAmount]);
}

async function borrow(qiToken, borrower, borrowAmount, opts = {}) {
  // make sure to have a block delta so we accrue interest
  await send(qiToken, 'harnessFastForward', [1]);
  return send(qiToken, 'borrow', [borrowAmount], {from: borrower});
}

async function preRepay(qiToken, benefactor, borrower, repayAmount) {
  // setup either benefactor OR borrower for success in repaying
  await send(qiToken.comptroller, 'setRepayBorrowAllowed', [true]);
  await send(qiToken.comptroller, 'setRepayBorrowVerify', [true]);
  await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiToken.underlying, 'harnessSetFailTransferFromAddress', [benefactor, false]);
  await send(qiToken.underlying, 'harnessSetFailTransferFromAddress', [borrower, false]);
  await pretendBorrow(qiToken, borrower, 1, 1, repayAmount);
  await preApprove(qiToken, benefactor, repayAmount);
  await preApprove(qiToken, borrower, repayAmount);
}

async function repayBorrowFresh(qiToken, payer, borrower, repayAmount) {
  return send(qiToken, 'harnessRepayBorrowFresh', [payer, borrower, repayAmount], {from: payer});
}

async function repayBorrow(qiToken, borrower, repayAmount) {
  // make sure to have a block delta so we accrue interest
  await send(qiToken, 'harnessFastForward', [1]);
  return send(qiToken, 'repayBorrow', [repayAmount], {from: borrower});
}

async function repayBorrowBehalf(qiToken, payer, borrower, repayAmount) {
  // make sure to have a block delta so we accrue interest
  await send(qiToken, 'harnessFastForward', [1]);
  return send(qiToken, 'repayBorrowBehalf', [borrower, repayAmount], {from: payer});
}

describe('QiToken', function () {
  let qiToken, root, borrower, benefactor, accounts;
  beforeEach(async () => {
    [root, borrower, benefactor, ...accounts] = saddle.accounts;
    qiToken = await makeQiToken({comptrollerOpts: {kind: 'bool'}});
  });

  describe('borrowFresh', () => {
    beforeEach(async () => await preBorrow(qiToken, borrower, borrowAmount));

    it("fails if comptroller tells it to", async () => {
      await send(qiToken.comptroller, 'setBorrowAllowed', [false]);
      expect(await borrowFresh(qiToken, borrower, borrowAmount)).toHaveTrollReject('BORROW_COMPTROLLER_REJECTION');
    });

    it("proceeds if comptroller tells it to", async () => {
      await expect(await borrowFresh(qiToken, borrower, borrowAmount)).toSucceed();
    });

    it("fails if market not fresh", async () => {
      await fastForward(qiToken);
      expect(await borrowFresh(qiToken, borrower, borrowAmount)).toHaveTokenFailure('MARKET_NOT_FRESH', 'BORROW_FRESHNESS_CHECK');
    });

    it("continues if fresh", async () => {
      await expect(await send(qiToken, 'accrueInterest')).toSucceed();
      await expect(await borrowFresh(qiToken, borrower, borrowAmount)).toSucceed();
    });

    it("fails if error if protocol has less than borrowAmount of underlying", async () => {
      expect(await borrowFresh(qiToken, borrower, borrowAmount.plus(1))).toHaveTokenFailure('TOKEN_INSUFFICIENT_CASH', 'BORROW_CASH_NOT_AVAILABLE');
    });

    it("fails if borrowBalanceStored fails (due to non-zero stored principal with zero account index)", async () => {
      await pretendBorrow(qiToken, borrower, 0, 3e18, 5e18);
      expect(await borrowFresh(qiToken, borrower, borrowAmount)).toHaveTokenFailure('MATH_ERROR', 'BORROW_ACCUMULATED_BALANCE_CALCULATION_FAILED');
    });

    it("fails if calculating account new total borrow balance overflows", async () => {
      await pretendBorrow(qiToken, borrower, 1e-18, 1e-18, UInt256Max());
      expect(await borrowFresh(qiToken, borrower, borrowAmount)).toHaveTokenFailure('MATH_ERROR', 'BORROW_NEW_ACCOUNT_BORROW_BALANCE_CALCULATION_FAILED');
    });

    it("fails if calculation of new total borrow balance overflows", async () => {
      await send(qiToken, 'harnessSetTotalBorrows', [UInt256Max()]);
      expect(await borrowFresh(qiToken, borrower, borrowAmount)).toHaveTokenFailure('MATH_ERROR', 'BORROW_NEW_TOTAL_BALANCE_CALCULATION_FAILED');
    });

    it("reverts if transfer out fails", async () => {
      await send(qiToken, 'harnessSetFailTransferToAddress', [borrower, true]);
      await expect(borrowFresh(qiToken, borrower, borrowAmount)).rejects.toRevert("revert TOKEN_TRANSFER_OUT_FAILED");
    });

    xit("reverts if borrowVerify fails", async() => {
      await send(qiToken.comptroller, 'setBorrowVerify', [false]);
      await expect(borrowFresh(qiToken, borrower, borrowAmount)).rejects.toRevert("revert borrowVerify rejected borrow");
    });

    it("transfers the underlying cash, tokens, and emits Transfer, Borrow events", async () => {
      const beforeProtocolCash = await balanceOf(qiToken.underlying, qiToken._address);
      const beforeProtocolBorrows = await totalBorrows(qiToken);
      const beforeAccountCash = await balanceOf(qiToken.underlying, borrower);
      const result = await borrowFresh(qiToken, borrower, borrowAmount);
      expect(result).toSucceed();
      expect(await balanceOf(qiToken.underlying, borrower)).toEqualNumber(beforeAccountCash.plus(borrowAmount));
      expect(await balanceOf(qiToken.underlying, qiToken._address)).toEqualNumber(beforeProtocolCash.minus(borrowAmount));
      expect(await totalBorrows(qiToken)).toEqualNumber(beforeProtocolBorrows.plus(borrowAmount));
      expect(result).toHaveLog('Transfer', {
        from: qiToken._address,
        to: borrower,
        amount: borrowAmount.toString()
      });
      expect(result).toHaveLog('Borrow', {
        borrower: borrower,
        borrowAmount: borrowAmount.toString(),
        accountBorrows: borrowAmount.toString(),
        totalBorrows: beforeProtocolBorrows.plus(borrowAmount).toString()
      });
    });

    it("stores new borrow principal and interest index", async () => {
      const beforeProtocolBorrows = await totalBorrows(qiToken);
      await pretendBorrow(qiToken, borrower, 0, 3, 0);
      await borrowFresh(qiToken, borrower, borrowAmount);
      const borrowSnap = await borrowSnapshot(qiToken, borrower);
      expect(borrowSnap.principal).toEqualNumber(borrowAmount);
      expect(borrowSnap.interestIndex).toEqualNumber(avaxMantissa(3));
      expect(await totalBorrows(qiToken)).toEqualNumber(beforeProtocolBorrows.plus(borrowAmount));
    });
  });

  describe('borrow', () => {
    beforeEach(async () => await preBorrow(qiToken, borrower, borrowAmount));

    it("emits a borrow failure if interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(borrow(qiToken, borrower, borrowAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from borrowFresh without emitting any extra logs", async () => {
      expect(await borrow(qiToken, borrower, borrowAmount.plus(1))).toHaveTokenFailure('TOKEN_INSUFFICIENT_CASH', 'BORROW_CASH_NOT_AVAILABLE');
    });

    it("returns success from borrowFresh and transfers the correct amount", async () => {
      const beforeAccountCash = await balanceOf(qiToken.underlying, borrower);
      await fastForward(qiToken);
      expect(await borrow(qiToken, borrower, borrowAmount)).toSucceed();
      expect(await balanceOf(qiToken.underlying, borrower)).toEqualNumber(beforeAccountCash.plus(borrowAmount));
    });
  });

  describe('repayBorrowFresh', () => {
    [true, false].forEach((benefactorIsPayer) => {
      let payer;
      const label = benefactorIsPayer ? "benefactor paying" : "borrower paying";
      describe(label, () => {
        beforeEach(async () => {
          payer = benefactorIsPayer ? benefactor : borrower;
          await preRepay(qiToken, payer, borrower, repayAmount);
        });

        it("fails if repay is not allowed", async () => {
          await send(qiToken.comptroller, 'setRepayBorrowAllowed', [false]);
          expect(await repayBorrowFresh(qiToken, payer, borrower, repayAmount)).toHaveTrollReject('REPAY_BORROW_COMPTROLLER_REJECTION', 'MATH_ERROR');
        });

        it("fails if block timestamp ≠ current block timestamp", async () => {
          await fastForward(qiToken);
          expect(await repayBorrowFresh(qiToken, payer, borrower, repayAmount)).toHaveTokenFailure('MARKET_NOT_FRESH', 'REPAY_BORROW_FRESHNESS_CHECK');
        });

        it("fails if insufficient approval", async() => {
          await preApprove(qiToken, payer, 1);
          await expect(repayBorrowFresh(qiToken, payer, borrower, repayAmount)).rejects.toRevert('revert Insufficient allowance');
        });

        it("fails if insufficient balance", async() => {
          await setBalance(qiToken.underlying, payer, 1);
          await expect(repayBorrowFresh(qiToken, payer, borrower, repayAmount)).rejects.toRevert('revert Insufficient balance');
        });


        it("returns an error if calculating account new account borrow balance fails", async () => {
          await pretendBorrow(qiToken, borrower, 1, 1, 1);
          await expect(repayBorrowFresh(qiToken, payer, borrower, repayAmount)).rejects.toRevert("revert REPAY_BORROW_NEW_ACCOUNT_BORROW_BALANCE_CALCULATION_FAILED");
        });

        it("returns an error if calculation of new total borrow balance fails", async () => {
          await send(qiToken, 'harnessSetTotalBorrows', [1]);
          await expect(repayBorrowFresh(qiToken, payer, borrower, repayAmount)).rejects.toRevert("revert REPAY_BORROW_NEW_TOTAL_BALANCE_CALCULATION_FAILED");
        });


        it("reverts if doTransferIn fails", async () => {
          await send(qiToken.underlying, 'harnessSetFailTransferFromAddress', [payer, true]);
          await expect(repayBorrowFresh(qiToken, payer, borrower, repayAmount)).rejects.toRevert("revert TOKEN_TRANSFER_IN_FAILED");
        });

        xit("reverts if repayBorrowVerify fails", async() => {
          await send(qiToken.comptroller, 'setRepayBorrowVerify', [false]);
          await expect(repayBorrowFresh(qiToken, payer, borrower, repayAmount)).rejects.toRevert("revert repayBorrowVerify rejected repayBorrow");
        });

        it("transfers the underlying cash, and emits Transfer, RepayBorrow events", async () => {
          const beforeProtocolCash = await balanceOf(qiToken.underlying, qiToken._address);
          const result = await repayBorrowFresh(qiToken, payer, borrower, repayAmount);
          expect(await balanceOf(qiToken.underlying, qiToken._address)).toEqualNumber(beforeProtocolCash.plus(repayAmount));
          expect(result).toHaveLog('Transfer', {
            from: payer,
            to: qiToken._address,
            amount: repayAmount.toString()
          });
          expect(result).toHaveLog('RepayBorrow', {
            payer: payer,
            borrower: borrower,
            repayAmount: repayAmount.toString(),
            accountBorrows: "0",
            totalBorrows: "0"
          });
        });

        it("stores new borrow principal and interest index", async () => {
          const beforeProtocolBorrows = await totalBorrows(qiToken);
          const beforeAccountBorrowSnap = await borrowSnapshot(qiToken, borrower);
          expect(await repayBorrowFresh(qiToken, payer, borrower, repayAmount)).toSucceed();
          const afterAccountBorrows = await borrowSnapshot(qiToken, borrower);
          expect(afterAccountBorrows.principal).toEqualNumber(beforeAccountBorrowSnap.principal.minus(repayAmount));
          expect(afterAccountBorrows.interestIndex).toEqualNumber(avaxMantissa(1));
          expect(await totalBorrows(qiToken)).toEqualNumber(beforeProtocolBorrows.minus(repayAmount));
        });
      });
    });
  });

  describe('repayBorrow', () => {
    beforeEach(async () => {
      await preRepay(qiToken, borrower, borrower, repayAmount);
    });

    it("emits a repay borrow failure if interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(repayBorrow(qiToken, borrower, repayAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from repayBorrowFresh without emitting any extra logs", async () => {
      await setBalance(qiToken.underlying, borrower, 1);
      await expect(repayBorrow(qiToken, borrower, repayAmount)).rejects.toRevert('revert Insufficient balance');
    });

    it("returns success from repayBorrowFresh and repays the right amount", async () => {
      await fastForward(qiToken);
      const beforeAccountBorrowSnap = await borrowSnapshot(qiToken, borrower);
      expect(await repayBorrow(qiToken, borrower, repayAmount)).toSucceed();
      const afterAccountBorrowSnap = await borrowSnapshot(qiToken, borrower);
      expect(afterAccountBorrowSnap.principal).toEqualNumber(beforeAccountBorrowSnap.principal.minus(repayAmount));
    });

    it("repays the full amount owed if payer has enough", async () => {
      await fastForward(qiToken);
      expect(await repayBorrow(qiToken, borrower, UInt256Max())).toSucceed();
      const afterAccountBorrowSnap = await borrowSnapshot(qiToken, borrower);
      expect(afterAccountBorrowSnap.principal).toEqualNumber(0);
    });

    it("fails gracefully if payer does not have enough", async () => {
      await setBalance(qiToken.underlying, borrower, 3);
      await fastForward(qiToken);
      await expect(repayBorrow(qiToken, borrower, UInt256Max())).rejects.toRevert('revert Insufficient balance');
    });
  });

  describe('repayBorrowBehalf', () => {
    let payer;

    beforeEach(async () => {
      payer = benefactor;
      await preRepay(qiToken, payer, borrower, repayAmount);
    });

    it("emits a repay borrow failure if interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(repayBorrowBehalf(qiToken, payer, borrower, repayAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from repayBorrowFresh without emitting any extra logs", async () => {
      await setBalance(qiToken.underlying, payer, 1);
      await expect(repayBorrowBehalf(qiToken, payer, borrower, repayAmount)).rejects.toRevert('revert Insufficient balance');
    });

    it("returns success from repayBorrowFresh and repays the right amount", async () => {
      await fastForward(qiToken);
      const beforeAccountBorrowSnap = await borrowSnapshot(qiToken, borrower);
      expect(await repayBorrowBehalf(qiToken, payer, borrower, repayAmount)).toSucceed();
      const afterAccountBorrowSnap = await borrowSnapshot(qiToken, borrower);
      expect(afterAccountBorrowSnap.principal).toEqualNumber(beforeAccountBorrowSnap.principal.minus(repayAmount));
    });
  });
});
