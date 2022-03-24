const {
  avaxUnsigned,
  avaxMantissa,
  UInt256Max
} = require('../Utils/Avalanche');

const {
  makeQiToken,
  balanceOf,
  fastForward,
  setBalance,
  getBalances,
  adjustBalances,
  preApprove,
  quickMint,
  preSupply,
  quickRedeem,
  quickRedeemUnderlying
} = require('../Utils/Benqi');

const exchangeRate = 50e3;
const mintAmount = avaxUnsigned(10e4);
const mintTokens = mintAmount.dividedBy(exchangeRate);
const redeemTokens = avaxUnsigned(10e3);
const redeemAmount = redeemTokens.multipliedBy(exchangeRate);

async function preMint(qiToken, minter, mintAmount, mintTokens, exchangeRate) {
  await preApprove(qiToken, minter, mintAmount);
  await send(qiToken.comptroller, 'setMintAllowed', [true]);
  await send(qiToken.comptroller, 'setMintVerify', [true]);
  await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiToken.underlying, 'harnessSetFailTransferFromAddress', [minter, false]);
  await send(qiToken, 'harnessSetBalance', [minter, 0]);
  await send(qiToken, 'harnessSetExchangeRate', [avaxMantissa(exchangeRate)]);
}

async function mintFresh(qiToken, minter, mintAmount) {
  return send(qiToken, 'harnessMintFresh', [minter, mintAmount]);
}

async function preRedeem(qiToken, redeemer, redeemTokens, redeemAmount, exchangeRate) {
  await preSupply(qiToken, redeemer, redeemTokens);
  await send(qiToken.comptroller, 'setRedeemAllowed', [true]);
  await send(qiToken.comptroller, 'setRedeemVerify', [true]);
  await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiToken.underlying, 'harnessSetBalance', [qiToken._address, redeemAmount]);
  await send(qiToken.underlying, 'harnessSetBalance', [redeemer, 0]);
  await send(qiToken.underlying, 'harnessSetFailTransferToAddress', [redeemer, false]);
  await send(qiToken, 'harnessSetExchangeRate', [avaxMantissa(exchangeRate)]);
}

async function redeemFreshTokens(qiToken, redeemer, redeemTokens, redeemAmount) {
  return send(qiToken, 'harnessRedeemFresh', [redeemer, redeemTokens, 0]);
}

async function redeemFreshAmount(qiToken, redeemer, redeemTokens, redeemAmount) {
  return send(qiToken, 'harnessRedeemFresh', [redeemer, 0, redeemAmount]);
}

describe('QiToken', function () {
  let root, minter, redeemer, accounts;
  let qiToken;
  beforeEach(async () => {
    [root, minter, redeemer, ...accounts] = saddle.accounts;
    qiToken = await makeQiToken({comptrollerOpts: {kind: 'bool'}, exchangeRate});
  });

  describe('mintFresh', () => {
    beforeEach(async () => {
      await preMint(qiToken, minter, mintAmount, mintTokens, exchangeRate);
    });

    it("fails if comptroller tells it to", async () => {
      await send(qiToken.comptroller, 'setMintAllowed', [false]);
      expect(await mintFresh(qiToken, minter, mintAmount)).toHaveTrollReject('MINT_COMPTROLLER_REJECTION', 'MATH_ERROR');
    });

    it("proceeds if comptroller tells it to", async () => {
      await expect(await mintFresh(qiToken, minter, mintAmount)).toSucceed();
    });

    it("fails if not fresh", async () => {
      await fastForward(qiToken);
      expect(await mintFresh(qiToken, minter, mintAmount)).toHaveTokenFailure('MARKET_NOT_FRESH', 'MINT_FRESHNESS_CHECK');
    });

    it("continues if fresh", async () => {
      await expect(await send(qiToken, 'accrueInterest')).toSucceed();
      expect(await mintFresh(qiToken, minter, mintAmount)).toSucceed();
    });

    it("fails if insufficient approval", async () => {
      expect(
        await send(qiToken.underlying, 'approve', [qiToken._address, 1], {from: minter})
      ).toSucceed();
      await expect(mintFresh(qiToken, minter, mintAmount)).rejects.toRevert('revert Insufficient allowance');
    });

    it("fails if insufficient balance", async() => {
      await setBalance(qiToken.underlying, minter, 1);
      await expect(mintFresh(qiToken, minter, mintAmount)).rejects.toRevert('revert Insufficient balance');
    });

    it("proceeds if sufficient approval and balance", async () =>{
      expect(await mintFresh(qiToken, minter, mintAmount)).toSucceed();
    });

    it("fails if exchange calculation fails", async () => {
      expect(await send(qiToken, 'harnessSetExchangeRate', [0])).toSucceed();
      await expect(mintFresh(qiToken, minter, mintAmount)).rejects.toRevert('revert MINT_EXCHANGE_CALCULATION_FAILED');
    });

    it("fails if transferring in fails", async () => {
      await send(qiToken.underlying, 'harnessSetFailTransferFromAddress', [minter, true]);
      await expect(mintFresh(qiToken, minter, mintAmount)).rejects.toRevert('revert TOKEN_TRANSFER_IN_FAILED');
    });

    it("transfers the underlying cash, tokens, and emits Mint, Transfer events", async () => {
      const beforeBalances = await getBalances([qiToken], [minter]);
      const result = await mintFresh(qiToken, minter, mintAmount);
      const afterBalances = await getBalances([qiToken], [minter]);
      expect(result).toSucceed();
      expect(result).toHaveLog('Mint', {
        minter,
        mintAmount: mintAmount.toString(),
        mintTokens: mintTokens.toString()
      });
      expect(result).toHaveLog(['Transfer', 1], {
        from: qiToken._address,
        to: minter,
        amount: mintTokens.toString()
      });
      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [qiToken, minter, 'cash', -mintAmount],
        [qiToken, minter, 'tokens', mintTokens],
        [qiToken, 'cash', mintAmount],
        [qiToken, 'tokens', mintTokens]
      ]));
    });
  });

  describe('mint', () => {
    beforeEach(async () => {
      await preMint(qiToken, minter, mintAmount, mintTokens, exchangeRate);
    });

    it("emits a mint failure if interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(quickMint(qiToken, minter, mintAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from mintFresh without emitting any extra logs", async () => {
      await send(qiToken.underlying, 'harnessSetBalance', [minter, 1]);
      await expect(mintFresh(qiToken, minter, mintAmount)).rejects.toRevert('revert Insufficient balance');
    });

    it("returns success from mintFresh and mints the correct number of tokens", async () => {
      expect(await quickMint(qiToken, minter, mintAmount)).toSucceed();
      expect(mintTokens).not.toEqualNumber(0);
      expect(await balanceOf(qiToken, minter)).toEqualNumber(mintTokens);
    });

    it("emits an AccrueInterest event", async () => {
      expect(await quickMint(qiToken, minter, mintAmount)).toHaveLog('AccrueInterest', {
        borrowIndex: "1000000000000000000",
        cashPrior: "0",
        interestAccumulated: "0",
        totalBorrows: "0",
      });
    });
  });

  [redeemFreshTokens, redeemFreshAmount].forEach((redeemFresh) => {
    describe(redeemFresh.name, () => {
      beforeEach(async () => {
        await preRedeem(qiToken, redeemer, redeemTokens, redeemAmount, exchangeRate);
      });

      it("fails if comptroller tells it to", async () =>{
        await send(qiToken.comptroller, 'setRedeemAllowed', [false]);
        expect(await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).toHaveTrollReject('REDEEM_COMPTROLLER_REJECTION');
      });

      it("fails if not fresh", async () => {
        await fastForward(qiToken);
        expect(await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).toHaveTokenFailure('MARKET_NOT_FRESH', 'REDEEM_FRESHNESS_CHECK');
      });

      it("continues if fresh", async () => {
        await expect(await send(qiToken, 'accrueInterest')).toSucceed();
        expect(await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).toSucceed();
      });

      it("fails if insufficient protocol cash to transfer out", async() => {
        await send(qiToken.underlying, 'harnessSetBalance', [qiToken._address, 1]);
        expect(await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).toHaveTokenFailure('TOKEN_INSUFFICIENT_CASH', 'REDEEM_TRANSFER_OUT_NOT_POSSIBLE');
      });

      it("fails if exchange calculation fails", async () => {
        if (redeemFresh == redeemFreshTokens) {
          expect(await send(qiToken, 'harnessSetExchangeRate', [UInt256Max()])).toSucceed();
          expect(await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).toHaveTokenFailure('MATH_ERROR', 'REDEEM_EXCHANGE_TOKENS_CALCULATION_FAILED');
        } else {
          expect(await send(qiToken, 'harnessSetExchangeRate', [0])).toSucceed();
          expect(await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).toHaveTokenFailure('MATH_ERROR', 'REDEEM_EXCHANGE_AMOUNT_CALCULATION_FAILED');
        }
      });

      it("fails if transferring out fails", async () => {
        await send(qiToken.underlying, 'harnessSetFailTransferToAddress', [redeemer, true]);
        await expect(redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).rejects.toRevert("revert TOKEN_TRANSFER_OUT_FAILED");
      });

      it("fails if total supply < redemption amount", async () => {
        await send(qiToken, 'harnessExchangeRateDetails', [0, 0, 0]);
        expect(await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).toHaveTokenFailure('MATH_ERROR', 'REDEEM_NEW_TOTAL_SUPPLY_CALCULATION_FAILED');
      });

      it("reverts if new account balance underflows", async () => {
        await send(qiToken, 'harnessSetBalance', [redeemer, 0]);
        expect(await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount)).toHaveTokenFailure('MATH_ERROR', 'REDEEM_NEW_ACCOUNT_BALANCE_CALCULATION_FAILED');
      });

      it("transfers the underlying cash, tokens, and emits Redeem, Transfer events", async () => {
        const beforeBalances = await getBalances([qiToken], [redeemer]);
        const result = await redeemFresh(qiToken, redeemer, redeemTokens, redeemAmount);
        const afterBalances = await getBalances([qiToken], [redeemer]);
        expect(result).toSucceed();
        expect(result).toHaveLog('Redeem', {
          redeemer,
          redeemAmount: redeemAmount.toString(),
          redeemTokens: redeemTokens.toString()
        });
        expect(result).toHaveLog(['Transfer', 1], {
          from: redeemer,
          to: qiToken._address,
          amount: redeemTokens.toString()
        });
        expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
          [qiToken, redeemer, 'cash', redeemAmount],
          [qiToken, redeemer, 'tokens', -redeemTokens],
          [qiToken, 'cash', -redeemAmount],
          [qiToken, 'tokens', -redeemTokens]
        ]));
      });
    });
  });

  describe('redeem', () => {
    beforeEach(async () => {
      await preRedeem(qiToken, redeemer, redeemTokens, redeemAmount, exchangeRate);
    });

    it("emits a redeem failure if interest accrual fails", async () => {
      await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(quickRedeem(qiToken, redeemer, redeemTokens)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from redeemFresh without emitting any extra logs", async () => {
      await setBalance(qiToken.underlying, qiToken._address, 0);
      expect(await quickRedeem(qiToken, redeemer, redeemTokens, {exchangeRate})).toHaveTokenFailure('TOKEN_INSUFFICIENT_CASH', 'REDEEM_TRANSFER_OUT_NOT_POSSIBLE');
    });

    it("returns success from redeemFresh and redeems the right amount", async () => {
      expect(
        await send(qiToken.underlying, 'harnessSetBalance', [qiToken._address, redeemAmount])
      ).toSucceed();
      expect(await quickRedeem(qiToken, redeemer, redeemTokens, {exchangeRate})).toSucceed();
      expect(redeemAmount).not.toEqualNumber(0);
      expect(await balanceOf(qiToken.underlying, redeemer)).toEqualNumber(redeemAmount);
    });

    it("returns success from redeemFresh and redeems the right amount of underlying", async () => {
      expect(
        await send(qiToken.underlying, 'harnessSetBalance', [qiToken._address, redeemAmount])
      ).toSucceed();
      expect(
        await quickRedeemUnderlying(qiToken, redeemer, redeemAmount, {exchangeRate})
      ).toSucceed();
      expect(redeemAmount).not.toEqualNumber(0);
      expect(await balanceOf(qiToken.underlying, redeemer)).toEqualNumber(redeemAmount);
    });

    it("emits an AccrueInterest event", async () => {
      expect(await quickMint(qiToken, minter, mintAmount)).toHaveLog('AccrueInterest', {
        borrowIndex: "1000000000000000000",
        cashPrior: "500000000",
        interestAccumulated: "0",
        totalBorrows: "0",
      });
    });
  });
});
