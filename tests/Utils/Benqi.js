"use strict";

const { dfn } = require('./JS');
const {
  encodeParameters,
  avaxBalance,
  avaxMantissa,
  avaxUnsigned,
  mergeInterface
} = require('./Avalanche');
const BigNumber = require('bignumber.js');

async function makeComptroller(opts = {}) {
  const {
    root = saddle.account,
    kind = 'unitroller'
  } = opts || {};

  if (kind == 'bool') {
    return await deploy('BoolComptroller');
  }

  if (kind == 'false-marker') {
    return await deploy('FalseMarkerMethodComptroller');
  }

  if (kind == 'v1-no-proxy') {
    const comptroller = await deploy('ComptrollerHarness');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = avaxMantissa(dfn(opts.closeFactor, .051));

    await send(comptroller, '_setCloseFactor', [closeFactor]);
    await send(comptroller, '_setPriceOracle', [priceOracle._address]);

    return Object.assign(comptroller, { priceOracle });
  }

  if (kind == 'unitroller-g2') {
    const unitroller = opts.unitroller || await deploy('Unitroller');
    const comptroller = await deploy('ComptrollerScenarioG2');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = avaxMantissa(dfn(opts.closeFactor, .051));
    const maxAssets = avaxUnsigned(dfn(opts.maxAssets, 10));
    const liquidationIncentive = avaxMantissa(1);

    await send(unitroller, '_setPendingImplementation', [comptroller._address]);
    await send(comptroller, '_become', [unitroller._address]);
    mergeInterface(unitroller, comptroller);
    await send(unitroller, '_setLiquidationIncentive', [liquidationIncentive]);
    await send(unitroller, '_setCloseFactor', [closeFactor]);
    await send(unitroller, '_setMaxAssets', [maxAssets]);
    await send(unitroller, '_setPriceOracle', [priceOracle._address]);

    return Object.assign(unitroller, { priceOracle });
  }

  if (kind == 'unitroller-g3') {
    const unitroller = opts.unitroller || await deploy('Unitroller');
    const comptroller = await deploy('ComptrollerScenarioG3');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = avaxMantissa(dfn(opts.closeFactor, .051));
    const maxAssets = avaxUnsigned(dfn(opts.maxAssets, 10));
    const liquidationIncentive = avaxMantissa(1);
    const qiRate = avaxUnsigned(dfn(opts.qiRate, 1e18));
    const qiMarkets = opts.qiMarkets || [];
    const otherMarkets = opts.otherMarkets || [];

    await send(unitroller, '_setPendingImplementation', [comptroller._address]);
    await send(comptroller, '_become', [unitroller._address, qiRate, qiMarkets, otherMarkets]);
    mergeInterface(unitroller, comptroller);
    await send(unitroller, '_setLiquidationIncentive', [liquidationIncentive]);
    await send(unitroller, '_setCloseFactor', [closeFactor]);
    await send(unitroller, '_setMaxAssets', [maxAssets]);
    await send(unitroller, '_setPriceOracle', [priceOracle._address]);

    return Object.assign(unitroller, { priceOracle });
  }

  if (kind == 'unitroller-g6') {
    const unitroller = opts.unitroller || await deploy('Unitroller');
    const comptroller = await deploy('ComptrollerScenarioG6');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = avaxMantissa(dfn(opts.closeFactor, .051));
    const liquidationIncentive = avaxMantissa(1);
    const benqi = opts.benqi || await deploy('Benqi', [opts.qiOwner || root]);
    const qiRate = avaxUnsigned(dfn(opts.qiRate, 1e18));

    await send(unitroller, '_setPendingImplementation', [comptroller._address]);
    await send(comptroller, '_become', [unitroller._address]);
    mergeInterface(unitroller, comptroller);
    await send(unitroller, '_setLiquidationIncentive', [liquidationIncentive]);
    await send(unitroller, '_setCloseFactor', [closeFactor]);
    await send(unitroller, '_setPriceOracle', [priceOracle._address]);
    await send(unitroller, '_setQiRate', [qiRate]);
    await send(unitroller, 'setQiAddress', [benqi._address]); // harness only

    return Object.assign(unitroller, { priceOracle, benqi });
  }

  if (kind == 'unitroller') {
    const unitroller = opts.unitroller || await deploy('Unitroller');
    const comptroller = await deploy('ComptrollerHarness');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = avaxMantissa(dfn(opts.closeFactor, .051));
    const liquidationIncentive = avaxMantissa(1);
    const benqi = opts.benqi || await deploy('Benqi', [opts.qiOwner || root]);
    const qiRate = avaxUnsigned(dfn(opts.qiRate, 1e18));

    await send(unitroller, '_setPendingImplementation', [comptroller._address]);
    await send(comptroller, '_become', [unitroller._address]);
    mergeInterface(unitroller, comptroller);
    await send(unitroller, '_setLiquidationIncentive', [liquidationIncentive]);
    await send(unitroller, '_setCloseFactor', [closeFactor]);
    await send(unitroller, '_setPriceOracle', [priceOracle._address]);
    await send(unitroller, 'setQiAddress', [benqi._address]); // harness only
    await send(unitroller, 'harnessSetQiRate', [qiRate]);

    return Object.assign(unitroller, { priceOracle, benqi });
  }
}

async function makeQiToken(opts = {}) {
  const {
    root = saddle.account,
    kind = 'qierc20'
  } = opts || {};

  const comptroller = opts.comptroller || await makeComptroller(opts.comptrollerOpts);
  const interestRateModel = opts.interestRateModel || await makeInterestRateModel(opts.interestRateModelOpts);
  const exchangeRate = avaxMantissa(dfn(opts.exchangeRate, 1));
  const decimals = avaxUnsigned(dfn(opts.decimals, 8));
  const symbol = opts.symbol || (kind === 'qiavax' ? 'qiAVAX' : 'cOMG');
  const name = opts.name || `QiToken ${symbol}`;
  const admin = opts.admin || root;

  let qiToken, underlying;
  let qiDelegator, qiDelegatee, qiDaiMaker;

  switch (kind) {
    case 'qiavax':
      qiToken = await deploy('QiAvaxHarness',
        [
          comptroller._address,
          interestRateModel._address,
          exchangeRate,
          name,
          symbol,
          decimals,
          admin
        ])
      break;

    case 'qidai':
      qiDaiMaker  = await deploy('QiDaiDelegateMakerHarness');
      underlying = qiDaiMaker;
      qiDelegatee = await deploy('QiDaiDelegateHarness');
      qiDelegator = await deploy('QiErc20Delegator',
        [
          underlying._address,
          comptroller._address,
          interestRateModel._address,
          exchangeRate,
          name,
          symbol,
          decimals,
          admin,
          qiDelegatee._address,
          encodeParameters(['address', 'address'], [qiDaiMaker._address, qiDaiMaker._address])
        ]
      );
      qiToken = await saddle.getContractAt('QiDaiDelegateHarness', qiDelegator._address);
      break;

    case 'qiqi':
      underlying = await deploy('Benqi', [opts.qiHolder || root]);
      qiDelegatee = await deploy('QiQiLikeDelegate');
      qiDelegator = await deploy('QiErc20Delegator',
        [
          underlying._address,
          comptroller._address,
          interestRateModel._address,
          exchangeRate,
          name,
          symbol,
          decimals,
          admin,
          qiDelegatee._address,
          "0x0"
        ]
      );
      qiToken = await saddle.getContractAt('QiQiLikeDelegate', qiDelegator._address);
      break;

    case 'qierc20':
    default:
      underlying = opts.underlying || await makeToken(opts.underlyingOpts);
      qiDelegatee = await deploy('QiErc20DelegateHarness');
      qiDelegator = await deploy('QiErc20Delegator',
        [
          underlying._address,
          comptroller._address,
          interestRateModel._address,
          exchangeRate,
          name,
          symbol,
          decimals,
          admin,
          qiDelegatee._address,
          "0x0"
        ]
      );
      qiToken = await saddle.getContractAt('QiErc20DelegateHarness', qiDelegator._address);
      break;
  }

  if (opts.supportMarket) {
    await send(comptroller, '_supportMarket', [qiToken._address]);
  }

  if (opts.addQiMarket) {
    await send(comptroller, '_addQiMarket', [qiToken._address]);
  }

  if (opts.underlyingPrice) {
    const price = avaxMantissa(opts.underlyingPrice);
    await send(comptroller.priceOracle, 'setUnderlyingPrice', [qiToken._address, price]);
  }

  if (opts.collateralFactor) {
    const factor = avaxMantissa(opts.collateralFactor);
    expect(await send(comptroller, '_setCollateralFactor', [qiToken._address, factor])).toSucceed();
  }

  return Object.assign(qiToken, { name, symbol, underlying, comptroller, interestRateModel });
}

async function makeInterestRateModel(opts = {}) {
  const {
    root = saddle.account,
    kind = 'harnessed'
  } = opts || {};

  if (kind == 'harnessed') {
    const borrowRate = avaxMantissa(dfn(opts.borrowRate, 0));
    return await deploy('InterestRateModelHarness', [borrowRate]);
  }

  if (kind == 'false-marker') {
    const borrowRate = avaxMantissa(dfn(opts.borrowRate, 0));
    return await deploy('FalseMarkerMethodInterestRateModel', [borrowRate]);
  }

  if (kind == 'white-paper') {
    const baseRate = avaxMantissa(dfn(opts.baseRate, 0));
    const multiplier = avaxMantissa(dfn(opts.multiplier, 1e-18));
    return await deploy('WhitePaperInterestRateModel', [baseRate, multiplier]);
  }

  if (kind == 'jump-rate') {
    const baseRate = avaxMantissa(dfn(opts.baseRate, 0));
    const multiplier = avaxMantissa(dfn(opts.multiplier, 1e-18));
    const jump = avaxMantissa(dfn(opts.jump, 0));
    const kink = avaxMantissa(dfn(opts.kink, 0));
    return await deploy('JumpRateModel', [baseRate, multiplier, jump, kink]);
  }
}

async function makePriceOracle(opts = {}) {
  const {
    root = saddle.account,
    kind = 'simple'
  } = opts || {};

  if (kind == 'simple') {
    return await deploy('SimplePriceOracle');
  }
}

async function makeToken(opts = {}) {
  const {
    root = saddle.account,
    kind = 'erc20'
  } = opts || {};

  if (kind == 'erc20') {
    const quantity = avaxUnsigned(dfn(opts.quantity, 1e25));
    const decimals = avaxUnsigned(dfn(opts.decimals, 18));
    const symbol = opts.symbol || 'OMG';
    const name = opts.name || `Erc20 ${symbol}`;
    return await deploy('ERC20Harness', [quantity, name, decimals, symbol]);
  }
}

async function balanceOf(token, account) {
  return avaxUnsigned(await call(token, 'balanceOf', [account]));
}

async function totalSupply(token) {
  return avaxUnsigned(await call(token, 'totalSupply'));
}

async function borrowSnapshot(qiToken, account) {
  const { principal, interestIndex } = await call(qiToken, 'harnessAccountBorrows', [account]);
  return { principal: avaxUnsigned(principal), interestIndex: avaxUnsigned(interestIndex) };
}

async function totalBorrows(qiToken) {
  return avaxUnsigned(await call(qiToken, 'totalBorrows'));
}

async function totalReserves(qiToken) {
  return avaxUnsigned(await call(qiToken, 'totalReserves'));
}

async function enterMarkets(qiTokens, from) {
  return await send(qiTokens[0].comptroller, 'enterMarkets', [qiTokens.map(c => c._address)], { from });
}

async function fastForward(qiToken, blocks = 5) {
  return await send(qiToken, 'harnessFastForward', [blocks]);
}

async function setBalance(qiToken, account, balance) {
  return await send(qiToken, 'harnessSetBalance', [account, balance]);
}

async function setAvaxBalance(qiAvax, balance) {
  const current = await avaxBalance(qiAvax._address);
  const root = saddle.account;
  expect(await send(qiAvax, 'harnessDoTransferOut', [root, current])).toSucceed();
  expect(await send(qiAvax, 'harnessDoTransferIn', [root, balance], { value: balance })).toSucceed();
}

async function getBalances(qiTokens, accounts) {
  const balances = {};
  for (let qiToken of qiTokens) {
    const qiBalances = balances[qiToken._address] = {};
    for (let account of accounts) {
      qiBalances[account] = {
        eth: await avaxBalance(account),
        cash: qiToken.underlying && await balanceOf(qiToken.underlying, account),
        tokens: await balanceOf(qiToken, account),
        borrows: (await borrowSnapshot(qiToken, account)).principal
      };
    }
    qiBalances[qiToken._address] = {
      eth: await avaxBalance(qiToken._address),
      cash: qiToken.underlying && await balanceOf(qiToken.underlying, qiToken._address),
      tokens: await totalSupply(qiToken),
      borrows: await totalBorrows(qiToken),
      reserves: await totalReserves(qiToken)
    };
  }
  return balances;
}

async function adjustBalances(balances, deltas) {
  for (let delta of deltas) {
    let qiToken, account, key, diff;
    if (delta.length == 4) {
      ([qiToken, account, key, diff] = delta);
    } else {
      ([qiToken, key, diff] = delta);
      account = qiToken._address;
    }

    balances[qiToken._address][account][key] = new BigNumber(balances[qiToken._address][account][key]).plus(diff);
  }
  return balances;
}


async function preApprove(qiToken, from, amount, opts = {}) {
  if (dfn(opts.faucet, true)) {
    expect(await send(qiToken.underlying, 'harnessSetBalance', [from, amount], { from })).toSucceed();
  }

  return send(qiToken.underlying, 'approve', [qiToken._address, amount], { from });
}

async function quickMint(qiToken, minter, mintAmount, opts = {}) {
  // make sure to accrue interest
  await fastForward(qiToken, 1);

  if (dfn(opts.approve, true)) {
    expect(await preApprove(qiToken, minter, mintAmount, opts)).toSucceed();
  }
  if (dfn(opts.exchangeRate)) {
    expect(await send(qiToken, 'harnessSetExchangeRate', [avaxMantissa(opts.exchangeRate)])).toSucceed();
  }
  return send(qiToken, 'mint', [mintAmount], { from: minter });
}


async function preSupply(qiToken, account, tokens, opts = {}) {
  if (dfn(opts.total, true)) {
    expect(await send(qiToken, 'harnessSetTotalSupply', [tokens])).toSucceed();
  }
  return send(qiToken, 'harnessSetBalance', [account, tokens]);
}

async function quickRedeem(qiToken, redeemer, redeemTokens, opts = {}) {
  await fastForward(qiToken, 1);

  if (dfn(opts.supply, true)) {
    expect(await preSupply(qiToken, redeemer, redeemTokens, opts)).toSucceed();
  }
  if (dfn(opts.exchangeRate)) {
    expect(await send(qiToken, 'harnessSetExchangeRate', [avaxMantissa(opts.exchangeRate)])).toSucceed();
  }
  return send(qiToken, 'redeem', [redeemTokens], { from: redeemer });
}

async function quickRedeemUnderlying(qiToken, redeemer, redeemAmount, opts = {}) {
  await fastForward(qiToken, 1);

  if (dfn(opts.exchangeRate)) {
    expect(await send(qiToken, 'harnessSetExchangeRate', [avaxMantissa(opts.exchangeRate)])).toSucceed();
  }
  return send(qiToken, 'redeemUnderlying', [redeemAmount], { from: redeemer });
}

async function setOraclePrice(qiToken, price) {
  return send(qiToken.comptroller.priceOracle, 'setUnderlyingPrice', [qiToken._address, avaxMantissa(price)]);
}

async function setBorrowRate(qiToken, rate) {
  return send(qiToken.interestRateModel, 'setBorrowRate', [avaxMantissa(rate)]);
}

async function getBorrowRate(interestRateModel, cash, borrows, reserves) {
  return call(interestRateModel, 'getBorrowRate', [cash, borrows, reserves].map(avaxUnsigned));
}

async function getSupplyRate(interestRateModel, cash, borrows, reserves, reserveFactor) {
  return call(interestRateModel, 'getSupplyRate', [cash, borrows, reserves, reserveFactor].map(avaxUnsigned));
}

async function pretendBorrow(qiToken, borrower, accountIndex, marketIndex, principalRaw, blockTimestamp = 2e7) {
  await send(qiToken, 'harnessSetTotalBorrows', [avaxUnsigned(principalRaw)]);
  await send(qiToken, 'harnessSetAccountBorrows', [borrower, avaxUnsigned(principalRaw), avaxMantissa(accountIndex)]);
  await send(qiToken, 'harnessSetBorrowIndex', [avaxMantissa(marketIndex)]);
  await send(qiToken, 'harnessSetAccrualBlockTimestamp', [avaxUnsigned(blockTimestamp)]);
  await send(qiToken, 'harnessSetBlockTimestamp', [avaxUnsigned(blockTimestamp)]);
}

module.exports = {
  makeComptroller,
  makeQiToken,
  makeInterestRateModel,
  makePriceOracle,
  makeToken,

  balanceOf,
  totalSupply,
  borrowSnapshot,
  totalBorrows,
  totalReserves,
  enterMarkets,
  fastForward,
  setBalance,
  setAvaxBalance,
  getBalances,
  adjustBalances,

  preApprove,
  quickMint,

  preSupply,
  quickRedeem,
  quickRedeemUnderlying,

  setOraclePrice,
  setBorrowRate,
  getBorrowRate,
  getSupplyRate,
  pretendBorrow
};
