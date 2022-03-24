const {
  avaxUnsigned,
  avaxMantissa,
  avaxExp,
} = require('./Utils/Avalanche');

const {
  makeComptroller,
  makeQiToken,
  preApprove,
  preSupply,
  quickRedeem,
} = require('./Utils/Benqi');

async function qiBalance(comptroller, user) {
  return avaxUnsigned(await call(comptroller.benqi, 'balanceOf', [user]))
}

async function qiAccrued(comptroller, user) {
  return avaxUnsigned(await call(comptroller, 'qiAccrued', [user]));
}

async function fastForwardPatch(patch, comptroller, blocks) {
  if (patch == 'unitroller') {
    return await send(comptroller, 'harnessFastForward', [blocks]);
  } else {
    return await send(comptroller, 'fastForward', [blocks]);
  }
}

const fs = require('fs');
const util = require('util');
const diffStringsUnified = require('jest-diff').default;


async function preRedeem(
  qiToken,
  redeemer,
  redeemTokens,
  redeemAmount,
  exchangeRate
) {
  await preSupply(qiToken, redeemer, redeemTokens);
  await send(qiToken.underlying, 'harnessSetBalance', [
    qiToken._address,
    redeemAmount
  ]);
}

const sortOpcodes = (opcodesMap) => {
  return Object.values(opcodesMap)
    .map(elem => [elem.fee, elem.name])
    .sort((a, b) => b[0] - a[0]);
};

const getGasCostFile = name => {
  try {
    const jsonString = fs.readFileSync(name);
    return JSON.parse(jsonString);
  } catch (err) {
    console.log(err);
    return {};
  }
};

const recordGasCost = (totalFee, key, filename, opcodes = {}) => {
  let fileObj = getGasCostFile(filename);
  const newCost = {fee: totalFee, opcodes: opcodes};
  console.log(diffStringsUnified(fileObj[key], newCost));
  fileObj[key] = newCost;
  fs.writeFileSync(filename, JSON.stringify(fileObj, null, ' '), 'utf-8');
};

async function mint(qiToken, minter, mintAmount, exchangeRate) {
  expect(await preApprove(qiToken, minter, mintAmount, {})).toSucceed();
  return send(qiToken, 'mint', [mintAmount], { from: minter });
}

async function claimQi(comptroller, holder) {
  return send(comptroller, 'claimQi', [holder], { from: holder });
}

/// GAS PROFILER: saves a digest of the gas prices of common QiToken operations
/// transiently fails, not sure why

describe('Gas report', () => {
  let root, minter, redeemer, accounts, qiToken;
  const exchangeRate = 50e3;
  const preMintAmount = avaxUnsigned(30e4);
  const mintAmount = avaxUnsigned(10e4);
  const mintTokens = mintAmount.div(exchangeRate);
  const redeemTokens = avaxUnsigned(10e3);
  const redeemAmount = redeemTokens.multipliedBy(exchangeRate);
  const filename = './gasCosts.json';

  describe('QiToken', () => {
    beforeEach(async () => {
      [root, minter, redeemer, ...accounts] = saddle.accounts;
      qiToken = await makeQiToken({
        comptrollerOpts: { kind: 'bool'}, 
        interestRateModelOpts: { kind: 'white-paper'},
        exchangeRate
      });
    });

    it('first mint', async () => {
      await send(qiToken, 'harnessSetAccrualBlockTimestamp', [40]);
      await send(qiToken, 'harnessSetBlockTimestamp', [41]);

      const trxReceipt = await mint(qiToken, minter, mintAmount, exchangeRate);
      recordGasCost(trxReceipt.gasUsed, 'first mint', filename);
    });

    it('second mint', async () => {
      await mint(qiToken, minter, mintAmount, exchangeRate);

      await send(qiToken, 'harnessSetAccrualBlockTimestamp', [40]);
      await send(qiToken, 'harnessSetBlockTimestamp', [41]);

      const mint2Receipt = await mint(qiToken, minter, mintAmount, exchangeRate);
      expect(Object.keys(mint2Receipt.events)).toEqual(['AccrueInterest', 'Transfer', 'Mint']);

      console.log(mint2Receipt.gasUsed);
      const opcodeCount = {};

      await saddle.trace(mint2Receipt, {
        execLog: log => {
          if (log.lastLog != undefined) {
            const key = `${log.op} @ ${log.gasCost}`;
            opcodeCount[key] = (opcodeCount[key] || 0) + 1;
          }
        }
      });

      recordGasCost(mint2Receipt.gasUsed, 'second mint', filename, opcodeCount);
    });

    it('second mint, no interest accrued', async () => {
      await mint(qiToken, minter, mintAmount, exchangeRate);

      await send(qiToken, 'harnessSetAccrualBlockTimestamp', [40]);
      await send(qiToken, 'harnessSetBlockTimestamp', [40]);

      const mint2Receipt = await mint(qiToken, minter, mintAmount, exchangeRate);
      expect(Object.keys(mint2Receipt.events)).toEqual(['Transfer', 'Mint']);
      recordGasCost(mint2Receipt.gasUsed, 'second mint, no interest accrued', filename);

      // console.log("NO ACCRUED");
      // const opcodeCount = {};
      // await saddle.trace(mint2Receipt, {
      //   execLog: log => {
      //     opcodeCount[log.op] = (opcodeCount[log.op] || 0) + 1;
      //   }
      // });
      // console.log(getOpcodeDigest(opcodeCount));
    });

    it('redeem', async () => {
      await preRedeem(qiToken, redeemer, redeemTokens, redeemAmount, exchangeRate);
      const trxReceipt = await quickRedeem(qiToken, redeemer, redeemTokens);
      recordGasCost(trxReceipt.gasUsed, 'redeem', filename);
    });

    it.skip('print mint opcode list', async () => {
      await preMint(qiToken, minter, mintAmount, mintTokens, exchangeRate);
      const trxReceipt = await quickMint(qiToken, minter, mintAmount);
      const opcodeCount = {};
      await saddle.trace(trxReceipt, {
        execLog: log => {
          opcodeCount[log.op] = (opcodeCount[log.op] || 0) + 1;
        }
      });
      console.log(getOpcodeDigest(opcodeCount));
    });
  });

  describe.each([
    ['unitroller-g6'],
    ['unitroller']
  ])('Benqi claims %s', (patch) => {
    beforeEach(async () => {
      [root, minter, redeemer, ...accounts] = saddle.accounts;
      comptroller = await makeComptroller({ kind: patch });
      let interestRateModelOpts = {borrowRate: 0.000001};
      qiToken = await makeQiToken({comptroller, supportMarket: true, underlyingPrice: 2, interestRateModelOpts});
      if (patch == 'unitroller') {
        await send(comptroller, '_setQiSpeed', [qiToken._address, avaxExp(0.05)]);
      } else {
        await send(comptroller, '_addQiMarkets', [[qiToken].map(c => c._address)]);
        await send(comptroller, 'setQiSpeed', [qiToken._address, avaxExp(0.05)]);
      }
      await send(comptroller.benqi, 'transfer', [comptroller._address, avaxUnsigned(50e18)], {from: root});
    });

    it(`${patch} second mint with benqi accrued`, async () => {
      await mint(qiToken, minter, mintAmount, exchangeRate);

      await fastForwardPatch(patch, comptroller, 10);

      console.log('Benqi balance before mint', (await qiBalance(comptroller, minter)).toString());
      console.log('Benqi accrued before mint', (await qiAccrued(comptroller, minter)).toString());
      const mint2Receipt = await mint(qiToken, minter, mintAmount, exchangeRate);
      console.log('Benqi balance after mint', (await qiBalance(comptroller, minter)).toString());
      console.log('Benqi accrued after mint', (await qiAccrued(comptroller, minter)).toString());
      recordGasCost(mint2Receipt.gasUsed, `${patch} second mint with benqi accrued`, filename);
    });

    it(`${patch} claim benqi`, async () => {
      await mint(qiToken, minter, mintAmount, exchangeRate);

      await fastForwardPatch(patch, comptroller, 10);

      console.log('Benqi balance before claim', (await qiBalance(comptroller, minter)).toString());
      console.log('Benqi accrued before claim', (await qiAccrued(comptroller, minter)).toString());
      const claimReceipt = await claimQi(comptroller, minter);
      console.log('Benqi balance after claim', (await qiBalance(comptroller, minter)).toString());
      console.log('Benqi accrued after claim', (await qiAccrued(comptroller, minter)).toString());
      recordGasCost(claimReceipt.gasUsed, `${patch} claim benqi`, filename);
    });
  });
});
