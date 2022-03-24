const {
  makeComptroller,
  makeQiToken
} = require('../Utils/Benqi');
const {
  avaxExp,
  avaxDouble,
  avaxUnsigned
} = require('../Utils/Avalanche');


// NB: coverage doesn't like this
describe.skip('Flywheel trace ops', () => {
  let root, a1, a2, a3, accounts;
  let comptroller, market;
  beforeEach(async () => {
    let interestRateModelOpts = {borrowRate: 0.000001};
    [root, a1, a2, a3, ...accounts] = saddle.accounts;
    comptroller = await makeComptroller();
    market = await makeQiToken({comptroller, supportMarket: true, underlyingPrice: 3, interestRateModelOpts});
    await send(comptroller, '_addQiMarkets', [[market].map(c => c._address)]);
  });

  it('update supply index SSTOREs', async () => {
    await send(comptroller, 'setBlockTimestamp', [100]);
    await send(market, 'harnessSetTotalBorrows', [avaxUnsigned(11e18)]);
    await send(comptroller, 'setQiSpeed', [market._address, avaxExp(0.5)]);

    const tx = await send(comptroller, 'harnessUpdateQiSupplyIndex', [market._address]);

    const ops = {};
    await saddle.trace(tx, {
      execLog: log => {
        if (log.lastLog != undefined) {
          ops[log.op] = (ops[log.op] || []).concat(log);
        }
      }
    });
    expect(ops.SSTORE.length).toEqual(1);
  });

  it('update borrow index SSTOREs', async () => {
    await send(comptroller, 'setBlockTimestamp', [100]);
    await send(market, 'harnessSetTotalBorrows', [avaxUnsigned(11e18)]);
    await send(comptroller, 'setQiSpeed', [market._address, avaxExp(0.5)]);

    const tx = await send(comptroller, 'harnessUpdateQiBorrowIndex', [market._address, avaxExp(1.1)]);

    const ops = {};
    await saddle.trace(tx, {
      execLog: log => {
        if (log.lastLog != undefined) {
          ops[log.op] = (ops[log.op] || []).concat(log);
        }
      }
    });
    expect(ops.SSTORE.length).toEqual(1);
  });
});