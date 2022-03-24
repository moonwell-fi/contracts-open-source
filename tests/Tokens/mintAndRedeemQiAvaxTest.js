const {
  avaxGasCost,
  avaxMantissa,
  avaxUnsigned,
  sendFallback
} = require('../Utils/Avalanche');

const {
  makeQiToken,
  balanceOf,
  fastForward,
  setBalance,
  setAvaxBalance,
  getBalances,
  adjustBalances,
} = require('../Utils/Benqi');

const exchangeRate = 5;
const mintAmount = avaxUnsigned(1e5);
const mintTokens = mintAmount.dividedBy(exchangeRate);
const redeemTokens = avaxUnsigned(10e3);
const redeemAmount = redeemTokens.multipliedBy(exchangeRate);

async function preMint(qiToken, minter, mintAmount, mintTokens, exchangeRate) {
  await send(qiToken.comptroller, 'setMintAllowed', [true]);
  await send(qiToken.comptroller, 'setMintVerify', [true]);
  await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiToken, 'harnessSetExchangeRate', [avaxMantissa(exchangeRate)]);
}

async function mintExplicit(qiToken, minter, mintAmount) {
  return send(qiToken, 'mint', [], {from: minter, value: mintAmount});
}

async function mintFallback(qiToken, minter, mintAmount) {
  return sendFallback(qiToken, {from: minter, value: mintAmount});
}

async function preRedeem(qiToken, redeemer, redeemTokens, redeemAmount, exchangeRate) {
  await send(qiToken.comptroller, 'setRedeemAllowed', [true]);
  await send(qiToken.comptroller, 'setRedeemVerify', [true]);
  await send(qiToken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(qiToken, 'harnessSetExchangeRate', [avaxMantissa(exchangeRate)]);
  await setAvaxBalance(qiToken, redeemAmount);
  await send(qiToken, 'harnessSetTotalSupply', [redeemTokens]);
  await setBalance(qiToken, redeemer, redeemTokens);
}

async function redeemQiTokens(qiToken, redeemer, redeemTokens, redeemAmount) {
  return send(qiToken, 'redeem', [redeemTokens], {from: redeemer});
}

async function redeemUnderlying(qiToken, redeemer, redeemTokens, redeemAmount) {
  return send(qiToken, 'redeemUnderlying', [redeemAmount], {from: redeemer});
}

describe('QiAvax', () => {
  let root, minter, redeemer, accounts;
  let qiToken;

  beforeEach(async () => {
    [root, minter, redeemer, ...accounts] = saddle.accounts;
    qiToken = await makeQiToken({kind: 'qiavax', comptrollerOpts: {kind: 'bool'}});
    await fastForward(qiToken, 1);
  });

  [mintExplicit, mintFallback].forEach((mint) => {
    describe(mint.name, () => {
      beforeEach(async () => {
        await preMint(qiToken, minter, mintAmount, mintTokens, exchangeRate);
      });

      it("reverts if interest accrual fails", async () => {
        await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
        await expect(mint(qiToken, minter, mintAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
      });

      it("returns success from mintFresh and mints the correct number of tokens", async () => {
        const beforeBalances = await getBalances([qiToken], [minter]);
        const receipt = await mint(qiToken, minter, mintAmount);
        const afterBalances = await getBalances([qiToken], [minter]);
        expect(receipt).toSucceed();
        expect(mintTokens).not.toEqualNumber(0);
        expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
          [qiToken, 'eth', mintAmount],
          [qiToken, 'tokens', mintTokens],
          [qiToken, minter, 'eth', -mintAmount.plus(await avaxGasCost(receipt))],
          [qiToken, minter, 'tokens', mintTokens]
        ]));
      });
    });
  });

  [redeemQiTokens, redeemUnderlying].forEach((redeem) => {
    describe(redeem.name, () => {
      beforeEach(async () => {
        await preRedeem(qiToken, redeemer, redeemTokens, redeemAmount, exchangeRate);
      });

      it("emits a redeem failure if interest accrual fails", async () => {
        await send(qiToken.interestRateModel, 'setFailBorrowRate', [true]);
        await expect(redeem(qiToken, redeemer, redeemTokens, redeemAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
      });

      it("returns error from redeemFresh without emitting any extra logs", async () => {
        expect(await redeem(qiToken, redeemer, redeemTokens.multipliedBy(5), redeemAmount.multipliedBy(5))).toHaveTokenFailure('MATH_ERROR', 'REDEEM_NEW_TOTAL_SUPPLY_CALCULATION_FAILED');
      });

      it("returns success from redeemFresh and redeems the correct amount", async () => {
        await fastForward(qiToken);
        const beforeBalances = await getBalances([qiToken], [redeemer]);
        const receipt = await redeem(qiToken, redeemer, redeemTokens, redeemAmount);
        expect(receipt).toTokenSucceed();
        const afterBalances = await getBalances([qiToken], [redeemer]);
        expect(redeemTokens).not.toEqualNumber(0);
        expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
          [qiToken, 'eth', -redeemAmount],
          [qiToken, 'tokens', -redeemTokens],
          [qiToken, redeemer, 'eth', redeemAmount.minus(await avaxGasCost(receipt))],
          [qiToken, redeemer, 'tokens', -redeemTokens]
        ]));
      });
    });
  });
});
