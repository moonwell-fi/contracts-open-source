const {
  makeComptroller,
  makeQiToken,
  balanceOf,
  fastForward,
  pretendBorrow,
  quickMint
} = require('../Utils/Benqi');
const {
  avaxExp,
  avaxDouble,
  avaxUnsigned,
  avaxMantissa
} = require('../Utils/Avalanche');

const qiRate = avaxUnsigned(1e18);

async function qiAccrued(comptroller, user) {
  return avaxUnsigned(await call(comptroller, 'qiAccrued', [user]));
}

async function qiBalance(comptroller, user) {
  return avaxUnsigned(await call(comptroller.benqi, 'balanceOf', [user]))
}

async function totalQiAccrued(comptroller, user) {
  return (await qiAccrued(comptroller, user)).plus(await qiBalance(comptroller, user));
}

describe('Flywheel upgrade', () => {
  describe('becomes the comptroller', () => {
    it('adds the benqi markets', async () => {
      let root = saddle.accounts[0];
      let unitroller = await makeComptroller({kind: 'unitroller-g2'});
      let qiMarkets = await Promise.all([1, 2, 3].map(async _ => {
        return makeQiToken({comptroller: unitroller, supportMarket: true});
      }));
      qiMarkets = qiMarkets.map(c => c._address);
      unitroller = await makeComptroller({kind: 'unitroller-g3', unitroller, qiMarkets});
      expect(await call(unitroller, 'getQiMarkets')).toEqual(qiMarkets);
    });

    it('adds the other markets', async () => {
      let root = saddle.accounts[0];
      let unitroller = await makeComptroller({kind: 'unitroller-g2'});
      let allMarkets = await Promise.all([1, 2, 3].map(async _ => {
        return makeQiToken({comptroller: unitroller, supportMarket: true});
      }));
      allMarkets = allMarkets.map(c => c._address);
      unitroller = await makeComptroller({
        kind: 'unitroller-g3',
        unitroller,
        qiMarkets: allMarkets.slice(0, 1),
        otherMarkets: allMarkets.slice(1)
      });
      expect(await call(unitroller, 'getAllMarkets')).toEqual(allMarkets);
      expect(await call(unitroller, 'getQiMarkets')).toEqual(allMarkets.slice(0, 1));
    });

    it('_supportMarket() adds to all markets, and only once', async () => {
      let root = saddle.accounts[0];
      let unitroller = await makeComptroller({kind: 'unitroller-g3'});
      let allMarkets = [];
      for (let _ of Array(10)) {
        allMarkets.push(await makeQiToken({comptroller: unitroller, supportMarket: true}));
      }
      expect(await call(unitroller, 'getAllMarkets')).toEqual(allMarkets.map(c => c._address));
      expect(
        makeComptroller({
          kind: 'unitroller-g3',
          unitroller,
          otherMarkets: [allMarkets[0]._address]
        })
      ).rejects.toRevert('revert market already added');
    });
  });
});

describe('Flywheel', () => {
  let root, a1, a2, a3, accounts;
  let comptroller, qiLOW, qiREP, qiZRX, qiEVIL;
  beforeEach(async () => {
    let interestRateModelOpts = {borrowRate: 0.000001};
    [root, a1, a2, a3, ...accounts] = saddle.accounts;
    comptroller = await makeComptroller();
    qiLOW = await makeQiToken({comptroller, supportMarket: true, underlyingPrice: 1, interestRateModelOpts});
    qiREP = await makeQiToken({comptroller, supportMarket: true, underlyingPrice: 2, interestRateModelOpts});
    qiZRX = await makeQiToken({comptroller, supportMarket: true, underlyingPrice: 3, interestRateModelOpts});
    qiEVIL = await makeQiToken({comptroller, supportMarket: false, underlyingPrice: 3, interestRateModelOpts});
  });

  describe('_grantQi()', () => {
    beforeEach(async () => {
      await send(comptroller.benqi, 'transfer', [comptroller._address, avaxUnsigned(50e18)], {from: root});
    });

    it('should award benqi if called by admin', async () => {
      const tx = await send(comptroller, '_grantQi', [a1, 100]);
      expect(tx).toHaveLog('QiGranted', {
        recipient: a1,
        amount: 100
      });
    });

    it('should revert if not called by admin', async () => {
      await expect(
        send(comptroller, '_grantQi', [a1, 100], {from: a1})
      ).rejects.toRevert('revert only admin can grant benqi');
    });

    it('should revert if insufficient benqi', async () => {
      await expect(
        send(comptroller, '_grantQi', [a1, avaxUnsigned(1e20)])
      ).rejects.toRevert('revert insufficient benqi for grant');
    });
  });

  describe('getQiMarkets()', () => {
    it('should return the benqi markets', async () => {
      for (let mkt of [qiLOW, qiREP, qiZRX]) {
        await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      }
      expect(await call(comptroller, 'getQiMarkets')).toEqual(
        [qiLOW, qiREP, qiZRX].map((c) => c._address)
      );
    });
  });

  describe('_setQiSpeed()', () => {
    it('should update market index when calling setQiSpeed', async () => {
      const mkt = qiREP;
      await send(comptroller, 'setBlockTimestamp', [0]);
      await send(mkt, 'harnessSetTotalSupply', [avaxUnsigned(10e18)]);

      await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      await fastForward(comptroller, 20);
      await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(1)]);

      const {index, timestamp} = await call(comptroller, 'qiSupplyState', [mkt._address]);
      expect(index).toEqualNumber(2e36);
      expect(timestamp).toEqualNumber(20);
    });

    it('should correctly drop a benqi market if called by admin', async () => {
      for (let mkt of [qiLOW, qiREP, qiZRX]) {
        await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      }
      const tx = await send(comptroller, '_setQiSpeed', [qiLOW._address, 0]);
      expect(await call(comptroller, 'getQiMarkets')).toEqual(
        [qiREP, qiZRX].map((c) => c._address)
      );
      expect(tx).toHaveLog('QiSpeedUpdated', {
        qiToken: qiLOW._address,
        newSpeed: 0
      });
    });

    it('should correctly drop a benqi market from middle of array', async () => {
      for (let mkt of [qiLOW, qiREP, qiZRX]) {
        await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      }
      await send(comptroller, '_setQiSpeed', [qiREP._address, 0]);
      expect(await call(comptroller, 'getQiMarkets')).toEqual(
        [qiLOW, qiZRX].map((c) => c._address)
      );
    });

    it('should not drop a benqi market unless called by admin', async () => {
      for (let mkt of [qiLOW, qiREP, qiZRX]) {
        await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      }
      await expect(
        send(comptroller, '_setQiSpeed', [qiLOW._address, 0], {from: a1})
      ).rejects.toRevert('revert only admin can set benqi speed');
    });

    it('should not add non-listed markets', async () => {
      const qiBAT = await makeQiToken({ comptroller, supportMarket: false });
      await expect(
        send(comptroller, 'harnessAddQiMarkets', [[qiBAT._address]])
      ).rejects.toRevert('revert benqi market is not listed');

      const markets = await call(comptroller, 'getQiMarkets');
      expect(markets).toEqual([]);
    });
  });

  describe('updateQiBorrowIndex()', () => {
    it('should calculate benqi borrower index correctly', async () => {
      const mkt = qiREP;
      await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      await send(comptroller, 'setBlockTimestamp', [100]);
      await send(mkt, 'harnessSetTotalBorrows', [avaxUnsigned(11e18)]);
      await send(comptroller, 'harnessUpdateQiBorrowIndex', [
        mkt._address,
        avaxExp(1.1),
      ]);
      /*
        100 blocks, 10e18 origin total borrows, 0.5e18 borrowSpeed

        borrowAmt   = totalBorrows * 1e18 / borrowIdx
                    = 11e18 * 1e18 / 1.1e18 = 10e18
        qiAccrued = deltaTimestamps * borrowSpeed
                    = 100 * 0.5e18 = 50e18
        newIndex   += 1e36 + qiAccrued * 1e36 / borrowAmt
                    = 1e36 + 50e18 * 1e36 / 10e18 = 6e36
      */

      const {index, timestamp} = await call(comptroller, 'qiBorrowState', [mkt._address]);
      expect(index).toEqualNumber(6e36);
      expect(timestamp).toEqualNumber(100);
    });

    it('should not revert or update qiBorrowState index if qiToken not in BENQI markets', async () => {
      const mkt = await makeQiToken({
        comptroller: comptroller,
        supportMarket: true,
        addQiMarket: false,
      });
      await send(comptroller, 'setBlockTimestamp', [100]);
      await send(comptroller, 'harnessUpdateQiBorrowIndex', [
        mkt._address,
        avaxExp(1.1),
      ]);

      const {index, timestamp} = await call(comptroller, 'qiBorrowState', [mkt._address]);
      expect(index).toEqualNumber(0);
      expect(timestamp).toEqualNumber(100);
      const speed = await call(comptroller, 'qiSpeeds', [mkt._address]);
      expect(speed).toEqualNumber(0);
    });

    it('should not update index if no blocks passed since last accrual', async () => {
      const mkt = qiREP;
      await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      await send(comptroller, 'harnessUpdateQiBorrowIndex', [
        mkt._address,
        avaxExp(1.1),
      ]);

      const {index, timestamp} = await call(comptroller, 'qiBorrowState', [mkt._address]);
      expect(index).toEqualNumber(1e36);
      expect(timestamp).toEqualNumber(0);
    });

    it('should not update index if benqi speed is 0', async () => {
      const mkt = qiREP;
      await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      await send(comptroller, 'setBlockTimestamp', [100]);
      await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0)]);
      await send(comptroller, 'harnessUpdateQiBorrowIndex', [
        mkt._address,
        avaxExp(1.1),
      ]);

      const {index, timestamp} = await call(comptroller, 'qiBorrowState', [mkt._address]);
      expect(index).toEqualNumber(1e36);
      expect(timestamp).toEqualNumber(100);
    });
  });

  describe('updateQiSupplyIndex()', () => {
    it('should calculate benqi supplier index correctly', async () => {
      const mkt = qiREP;
      await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      await send(comptroller, 'setBlockTimestamp', [100]);
      await send(mkt, 'harnessSetTotalSupply', [avaxUnsigned(10e18)]);
      await send(comptroller, 'harnessUpdateQiSupplyIndex', [mkt._address]);
      /*
        suppyTokens = 10e18
        qiAccrued = deltaTimestamps * supplySpeed
                    = 100 * 0.5e18 = 50e18
        newIndex   += qiAccrued * 1e36 / supplyTokens
                    = 1e36 + 50e18 * 1e36 / 10e18 = 6e36
      */
      const {index, timestamp} = await call(comptroller, 'qiSupplyState', [mkt._address]);
      expect(index).toEqualNumber(6e36);
      expect(timestamp).toEqualNumber(100);
    });

    it('should not update index on non-BENQI markets', async () => {
      const mkt = await makeQiToken({
        comptroller: comptroller,
        supportMarket: true,
        addQiMarket: false
      });
      await send(comptroller, 'setBlockTimestamp', [100]);
      await send(comptroller, 'harnessUpdateQiSupplyIndex', [
        mkt._address
      ]);

      const {index, timestamp} = await call(comptroller, 'qiSupplyState', [mkt._address]);
      expect(index).toEqualNumber(0);
      expect(timestamp).toEqualNumber(100);
      const speed = await call(comptroller, 'qiSpeeds', [mkt._address]);
      expect(speed).toEqualNumber(0);
      // qitoken could have no benqi speed or benqi supplier state if not in benqi markets
      // this logic could also possibly be implemented in the allowed hook
    });

    it('should not update index if no blocks passed since last accrual', async () => {
      const mkt = qiREP;
      await send(comptroller, 'setBlockTimestamp', [0]);
      await send(mkt, 'harnessSetTotalSupply', [avaxUnsigned(10e18)]);
      await send(comptroller, '_setQiSpeed', [mkt._address, avaxExp(0.5)]);
      await send(comptroller, 'harnessUpdateQiSupplyIndex', [mkt._address]);

      const {index, timestamp} = await call(comptroller, 'qiSupplyState', [mkt._address]);
      expect(index).toEqualNumber(1e36);
      expect(timestamp).toEqualNumber(0);
    });

    it('should not matter if the index is updated multiple times', async () => {
      const qiRemaining = qiRate.multipliedBy(100)
      await send(comptroller, 'harnessAddQiMarkets', [[qiLOW._address]]);
      await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      await pretendBorrow(qiLOW, a1, 1, 1, 100);
      await send(comptroller, 'harnessRefreshQiSpeeds');

      await quickMint(qiLOW, a2, avaxUnsigned(10e18));
      await quickMint(qiLOW, a3, avaxUnsigned(15e18));

      const a2Accrued0 = await totalQiAccrued(comptroller, a2);
      const a3Accrued0 = await totalQiAccrued(comptroller, a3);
      const a2Balance0 = await balanceOf(qiLOW, a2);
      const a3Balance0 = await balanceOf(qiLOW, a3);

      await fastForward(comptroller, 20);

      const txT1 = await send(qiLOW, 'transfer', [a2, a3Balance0.minus(a2Balance0)], {from: a3});

      const a2Accrued1 = await totalQiAccrued(comptroller, a2);
      const a3Accrued1 = await totalQiAccrued(comptroller, a3);
      const a2Balance1 = await balanceOf(qiLOW, a2);
      const a3Balance1 = await balanceOf(qiLOW, a3);

      await fastForward(comptroller, 10);
      await send(comptroller, 'harnessUpdateQiSupplyIndex', [qiLOW._address]);
      await fastForward(comptroller, 10);

      const txT2 = await send(qiLOW, 'transfer', [a3, a2Balance1.minus(a3Balance1)], {from: a2});

      const a2Accrued2 = await totalQiAccrued(comptroller, a2);
      const a3Accrued2 = await totalQiAccrued(comptroller, a3);

      expect(a2Accrued0).toEqualNumber(0);
      expect(a3Accrued0).toEqualNumber(0);
      expect(a2Accrued1).not.toEqualNumber(0);
      expect(a3Accrued1).not.toEqualNumber(0);
      expect(a2Accrued1).toEqualNumber(a3Accrued2.minus(a3Accrued1));
      expect(a3Accrued1).toEqualNumber(a2Accrued2.minus(a2Accrued1));

      expect(txT1.gasUsed).toBeLessThan(200000);
      expect(txT1.gasUsed).toBeGreaterThan(140000);
      expect(txT2.gasUsed).toBeLessThan(150000);
      expect(txT2.gasUsed).toBeGreaterThan(100000);
    });
  });

  describe('distributeBorrowerQi()', () => {

    it('should update borrow index checkpoint but not qiAccrued for first time user', async () => {
      const mkt = qiREP;
      await send(comptroller, "setQiBorrowState", [mkt._address, avaxDouble(6), 10]);
      await send(comptroller, "setQiBorrowerIndex", [mkt._address, root, avaxUnsigned(0)]);

      await send(comptroller, "harnessDistributeBorrowerQi", [mkt._address, root, avaxExp(1.1)]);
      expect(await call(comptroller, "qiAccrued", [root])).toEqualNumber(0);
      expect(await call(comptroller, "qiBorrowerIndex", [ mkt._address, root])).toEqualNumber(6e36);
    });

    it('should transfer benqi and update borrow index checkpoint correctly for repeat time user', async () => {
      const mkt = qiREP;
      await send(comptroller.benqi, 'transfer', [comptroller._address, avaxUnsigned(50e18)], {from: root});
      await send(mkt, "harnessSetAccountBorrows", [a1, avaxUnsigned(5.5e18), avaxExp(1)]);
      await send(comptroller, "setQiBorrowState", [mkt._address, avaxDouble(6), 10]);
      await send(comptroller, "setQiBorrowerIndex", [mkt._address, a1, avaxDouble(1)]);

      /*
      * 100 delta blocks, 10e18 origin total borrows, 0.5e18 borrowSpeed => 6e18 qiBorrowIndex
      * this tests that an acct with half the total borrows over that time gets 25e18 BENQI
        borrowerAmount = borrowBalance * 1e18 / borrow idx
                       = 5.5e18 * 1e18 / 1.1e18 = 5e18
        deltaIndex     = marketStoredIndex - userStoredIndex
                       = 6e36 - 1e36 = 5e36
        borrowerAccrued= borrowerAmount * deltaIndex / 1e36
                       = 5e18 * 5e36 / 1e36 = 25e18
      */
      const tx = await send(comptroller, "harnessDistributeBorrowerQi", [mkt._address, a1, avaxUnsigned(1.1e18)]);
      expect(await qiAccrued(comptroller, a1)).toEqualNumber(25e18);
      expect(await qiBalance(comptroller, a1)).toEqualNumber(0);
      expect(tx).toHaveLog('DistributedBorrowerQi', {
        qiToken: mkt._address,
        borrower: a1,
        qiDelta: avaxUnsigned(25e18).toFixed(),
        qiBorrowIndex: avaxDouble(6).toFixed()
      });
    });

    it('should not transfer benqi automatically', async () => {
      const mkt = qiREP;
      await send(comptroller.benqi, 'transfer', [comptroller._address, avaxUnsigned(50e18)], {from: root});
      await send(mkt, "harnessSetAccountBorrows", [a1, avaxUnsigned(5.5e17), avaxExp(1)]);
      await send(comptroller, "setQiBorrowState", [mkt._address, avaxDouble(1.0019), 10]);
      await send(comptroller, "setQiBorrowerIndex", [mkt._address, a1, avaxDouble(1)]);
      /*
        borrowerAmount = borrowBalance * 1e18 / borrow idx
                       = 5.5e17 * 1e18 / 1.1e18 = 5e17
        deltaIndex     = marketStoredIndex - userStoredIndex
                       = 1.0019e36 - 1e36 = 0.0019e36
        borrowerAccrued= borrowerAmount * deltaIndex / 1e36
                       = 5e17 * 0.0019e36 / 1e36 = 0.00095e18
        0.00095e18 < qiClaimThreshold of 0.001e18
      */
      await send(comptroller, "harnessDistributeBorrowerQi", [mkt._address, a1, avaxExp(1.1)]);
      expect(await qiAccrued(comptroller, a1)).toEqualNumber(0.00095e18);
      expect(await qiBalance(comptroller, a1)).toEqualNumber(0);
    });

    it('should not revert or distribute when called with non-BENQI market', async () => {
      const mkt = await makeQiToken({
        comptroller: comptroller,
        supportMarket: true,
        addQiMarket: false,
      });

      await send(comptroller, "harnessDistributeBorrowerQi", [mkt._address, a1, avaxExp(1.1)]);
      expect(await qiAccrued(comptroller, a1)).toEqualNumber(0);
      expect(await qiBalance(comptroller, a1)).toEqualNumber(0);
      expect(await call(comptroller, 'qiBorrowerIndex', [mkt._address, a1])).toEqualNumber(0);
    });
  });

  describe('distributeSupplierQi()', () => {
    it('should transfer benqi and update supply index correctly for first time user', async () => {
      const mkt = qiREP;
      await send(comptroller.benqi, 'transfer', [comptroller._address, avaxUnsigned(50e18)], {from: root});

      await send(mkt, "harnessSetBalance", [a1, avaxUnsigned(5e18)]);
      await send(comptroller, "setQiSupplyState", [mkt._address, avaxDouble(6), 10]);
      /*
      * 100 delta blocks, 10e18 total supply, 0.5e18 supplySpeed => 6e18 qiSupplyIndex
      * confirming an acct with half the total supply over that time gets 25e18 BENQI:
        supplierAmount  = 5e18
        deltaIndex      = marketStoredIndex - userStoredIndex
                        = 6e36 - 1e36 = 5e36
        suppliedAccrued+= supplierTokens * deltaIndex / 1e36
                        = 5e18 * 5e36 / 1e36 = 25e18
      */

      const tx = await send(comptroller, "harnessDistributeAllSupplierQi", [mkt._address, a1]);
      expect(await qiAccrued(comptroller, a1)).toEqualNumber(0);
      expect(await qiBalance(comptroller, a1)).toEqualNumber(25e18);
      expect(tx).toHaveLog('DistributedSupplierQi', {
        qiToken: mkt._address,
        supplier: a1,
        qiDelta: avaxUnsigned(25e18).toFixed(),
        qiSupplyIndex: avaxDouble(6).toFixed()
      });
    });

    it('should update benqi accrued and supply index for repeat user', async () => {
      const mkt = qiREP;
      await send(comptroller.benqi, 'transfer', [comptroller._address, avaxUnsigned(50e18)], {from: root});

      await send(mkt, "harnessSetBalance", [a1, avaxUnsigned(5e18)]);
      await send(comptroller, "setQiSupplyState", [mkt._address, avaxDouble(6), 10]);
      await send(comptroller, "setQiSupplierIndex", [mkt._address, a1, avaxDouble(2)])
      /*
        supplierAmount  = 5e18
        deltaIndex      = marketStoredIndex - userStoredIndex
                        = 6e36 - 2e36 = 4e36
        suppliedAccrued+= supplierTokens * deltaIndex / 1e36
                        = 5e18 * 4e36 / 1e36 = 20e18
      */

      await send(comptroller, "harnessDistributeAllSupplierQi", [mkt._address, a1]);
      expect(await qiAccrued(comptroller, a1)).toEqualNumber(0);
      expect(await qiBalance(comptroller, a1)).toEqualNumber(20e18);
    });

    it('should not transfer when qiAccrued below threshold', async () => {
      const mkt = qiREP;
      await send(comptroller.benqi, 'transfer', [comptroller._address, avaxUnsigned(50e18)], {from: root});

      await send(mkt, "harnessSetBalance", [a1, avaxUnsigned(5e17)]);
      await send(comptroller, "setQiSupplyState", [mkt._address, avaxDouble(1.0019), 10]);
      /*
        supplierAmount  = 5e17
        deltaIndex      = marketStoredIndex - userStoredIndex
                        = 1.0019e36 - 1e36 = 0.0019e36
        suppliedAccrued+= supplierTokens * deltaIndex / 1e36
                        = 5e17 * 0.0019e36 / 1e36 = 0.00095e18
      */

      await send(comptroller, "harnessDistributeSupplierQi", [mkt._address, a1]);
      expect(await qiAccrued(comptroller, a1)).toEqualNumber(0.00095e18);
      expect(await qiBalance(comptroller, a1)).toEqualNumber(0);
    });

    it('should not revert or distribute when called with non-BENQI market', async () => {
      const mkt = await makeQiToken({
        comptroller: comptroller,
        supportMarket: true,
        addQiMarket: false,
      });

      await send(comptroller, "harnessDistributeSupplierQi", [mkt._address, a1]);
      expect(await qiAccrued(comptroller, a1)).toEqualNumber(0);
      expect(await qiBalance(comptroller, a1)).toEqualNumber(0);
      expect(await call(comptroller, 'qiBorrowerIndex', [mkt._address, a1])).toEqualNumber(0);
    });

  });

  describe('transferQi', () => {
    it('should transfer benqi accrued when amount is above threshold', async () => {
      const qiRemaining = 1000, a1AccruedPre = 100, threshold = 1;
      const qiBalancePre = await qiBalance(comptroller, a1);
      const tx0 = await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      const tx1 = await send(comptroller, 'setQiAccrued', [a1, a1AccruedPre]);
      const tx2 = await send(comptroller, 'harnessTransferComp', [a1, a1AccruedPre, threshold]);
      const a1AccruedPost = await qiAccrued(comptroller, a1);
      const qiBalancePost = await qiBalance(comptroller, a1);
      expect(qiBalancePre).toEqualNumber(0);
      expect(qiBalancePost).toEqualNumber(a1AccruedPre);
    });

    it('should not transfer when benqi accrued is below threshold', async () => {
      const qiRemaining = 1000, a1AccruedPre = 100, threshold = 101;
      const qiBalancePre = await call(comptroller.benqi, 'balanceOf', [a1]);
      const tx0 = await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      const tx1 = await send(comptroller, 'setQiAccrued', [a1, a1AccruedPre]);
      const tx2 = await send(comptroller, 'harnessTransferComp', [a1, a1AccruedPre, threshold]);
      const a1AccruedPost = await qiAccrued(comptroller, a1);
      const qiBalancePost = await qiBalance(comptroller, a1);
      expect(qiBalancePre).toEqualNumber(0);
      expect(qiBalancePost).toEqualNumber(0);
    });

    it('should not transfer benqi if benqi accrued is greater than benqi remaining', async () => {
      const qiRemaining = 99, a1AccruedPre = 100, threshold = 1;
      const qiBalancePre = await qiBalance(comptroller, a1);
      const tx0 = await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      const tx1 = await send(comptroller, 'setQiAccrued', [a1, a1AccruedPre]);
      const tx2 = await send(comptroller, 'harnessTransferComp', [a1, a1AccruedPre, threshold]);
      const a1AccruedPost = await qiAccrued(comptroller, a1);
      const qiBalancePost = await qiBalance(comptroller, a1);
      expect(qiBalancePre).toEqualNumber(0);
      expect(qiBalancePost).toEqualNumber(0);
    });
  });

  describe('claimQi', () => {
    it('should accrue benqi and then transfer benqi accrued', async () => {
      const qiRemaining = qiRate.multipliedBy(100), mintAmount = avaxUnsigned(12e18), deltaTimestamps = 10;
      await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      await pretendBorrow(qiLOW, a1, 1, 1, 100);
      await send(comptroller, '_setQiSpeed', [qiLOW._address, avaxExp(0.5)]);
      await send(comptroller, 'harnessRefreshQiSpeeds');
      const speed = await call(comptroller, 'qiSpeeds', [qiLOW._address]);
      const a2AccruedPre = await qiAccrued(comptroller, a2);
      const qiBalancePre = await qiBalance(comptroller, a2);
      await quickMint(qiLOW, a2, mintAmount);
      await fastForward(comptroller, deltaTimestamps);
      const tx = await send(comptroller, 'claimQi', [a2]);
      const a2AccruedPost = await qiAccrued(comptroller, a2);
      const qiBalancePost = await qiBalance(comptroller, a2);
      expect(tx.gasUsed).toBeLessThan(400000);
      expect(speed).toEqualNumber(qiRate);
      expect(a2AccruedPre).toEqualNumber(0);
      expect(a2AccruedPost).toEqualNumber(0);
      expect(qiBalancePre).toEqualNumber(0);
      expect(qiBalancePost).toEqualNumber(qiRate.multipliedBy(deltaTimestamps).minus(1)); // index is 8333...
    });

    it('should accrue benqi and then transfer benqi accrued in a single market', async () => {
      const qiRemaining = qiRate.multipliedBy(100), mintAmount = avaxUnsigned(12e18), deltaTimestamps = 10;
      await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      await pretendBorrow(qiLOW, a1, 1, 1, 100);
      await send(comptroller, 'harnessAddQiMarkets', [[qiLOW._address]]);
      await send(comptroller, 'harnessRefreshQiSpeeds');
      const speed = await call(comptroller, 'qiSpeeds', [qiLOW._address]);
      const a2AccruedPre = await qiAccrued(comptroller, a2);
      const qiBalancePre = await qiBalance(comptroller, a2);
      await quickMint(qiLOW, a2, mintAmount);
      await fastForward(comptroller, deltaTimestamps);
      const tx = await send(comptroller, 'claimQi', [a2, [qiLOW._address]]);
      const a2AccruedPost = await qiAccrued(comptroller, a2);
      const qiBalancePost = await qiBalance(comptroller, a2);
      expect(tx.gasUsed).toBeLessThan(170000);
      expect(speed).toEqualNumber(qiRate);
      expect(a2AccruedPre).toEqualNumber(0);
      expect(a2AccruedPost).toEqualNumber(0);
      expect(qiBalancePre).toEqualNumber(0);
      expect(qiBalancePost).toEqualNumber(qiRate.multipliedBy(deltaTimestamps).minus(1)); // index is 8333...
    });

    it('should claim when benqi accrued is below threshold', async () => {
      const qiRemaining = avaxExp(1), accruedAmt = avaxUnsigned(0.0009e18)
      await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      await send(comptroller, 'setQiAccrued', [a1, accruedAmt]);
      await send(comptroller, 'claimQi', [a1, [qiLOW._address]]);
      expect(await qiAccrued(comptroller, a1)).toEqualNumber(0);
      expect(await qiBalance(comptroller, a1)).toEqualNumber(accruedAmt);
    });

    it('should revert when a market is not listed', async () => {
      const qiNOT = await makeQiToken({comptroller});
      await expect(
        send(comptroller, 'claimQi', [a1, [qiNOT._address]])
      ).rejects.toRevert('revert market must be listed');
    });
  });

  describe('claimQi batch', () => {
    it('should revert when claiming benqi from non-listed market', async () => {
      const qiRemaining = qiRate.multipliedBy(100), deltaTimestamps = 10, mintAmount = avaxExp(10);
      await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      let [_, __, ...claimAccts] = saddle.accounts;

      for(let from of claimAccts) {
        expect(await send(qiLOW.underlying, 'harnessSetBalance', [from, mintAmount], { from })).toSucceed();
        send(qiLOW.underlying, 'approve', [qiLOW._address, mintAmount], { from });
        send(qiLOW, 'mint', [mintAmount], { from });
      }

      await pretendBorrow(qiLOW, root, 1, 1, avaxExp(10));
      await send(comptroller, 'harnessRefreshQiSpeeds');

      await fastForward(comptroller, deltaTimestamps);

      await expect(send(comptroller, 'claimQi', [claimAccts, [qiLOW._address, qiEVIL._address], true, true])).rejects.toRevert('revert market must be listed');
    });

    it('should claim the expected amount when holders and qitokens arg is duplicated', async () => {
      const qiRemaining = qiRate.multipliedBy(100), deltaTimestamps = 10, mintAmount = avaxExp(10);
      await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      let [_, __, ...claimAccts] = saddle.accounts;
      for(let from of claimAccts) {
        expect(await send(qiLOW.underlying, 'harnessSetBalance', [from, mintAmount], { from })).toSucceed();
        send(qiLOW.underlying, 'approve', [qiLOW._address, mintAmount], { from });
        send(qiLOW, 'mint', [mintAmount], { from });
      }
      await pretendBorrow(qiLOW, root, 1, 1, avaxExp(10));
      await send(comptroller, 'harnessAddQiMarkets', [[qiLOW._address]]);
      await send(comptroller, 'harnessRefreshQiSpeeds');

      await fastForward(comptroller, deltaTimestamps);

      const tx = await send(comptroller, 'claimQi', [[...claimAccts, ...claimAccts], [qiLOW._address, qiLOW._address], false, true]);
      // benqi distributed => 10e18
      for(let acct of claimAccts) {
        expect(await call(comptroller, 'qiSupplierIndex', [qiLOW._address, acct])).toEqualNumber(avaxDouble(1.125));
        expect(await qiBalance(comptroller, acct)).toEqualNumber(avaxExp(1.25));
      }
    });

    it('claims benqi for multiple suppliers only', async () => {
      const qiRemaining = qiRate.multipliedBy(100), deltaTimestamps = 10, mintAmount = avaxExp(10);
      await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      let [_, __, ...claimAccts] = saddle.accounts;
      for(let from of claimAccts) {
        expect(await send(qiLOW.underlying, 'harnessSetBalance', [from, mintAmount], { from })).toSucceed();
        send(qiLOW.underlying, 'approve', [qiLOW._address, mintAmount], { from });
        send(qiLOW, 'mint', [mintAmount], { from });
      }
      await pretendBorrow(qiLOW, root, 1, 1, avaxExp(10));
      await send(comptroller, 'harnessAddQiMarkets', [[qiLOW._address]]);
      await send(comptroller, 'harnessRefreshQiSpeeds');

      await fastForward(comptroller, deltaTimestamps);

      const tx = await send(comptroller, 'claimQi', [claimAccts, [qiLOW._address], false, true]);
      // benqi distributed => 10e18
      for(let acct of claimAccts) {
        expect(await call(comptroller, 'qiSupplierIndex', [qiLOW._address, acct])).toEqualNumber(avaxDouble(1.125));
        expect(await qiBalance(comptroller, acct)).toEqualNumber(avaxExp(1.25));
      }
    });

    it('claims benqi for multiple borrowers only, primes uninitiated', async () => {
      const qiRemaining = qiRate.multipliedBy(100), deltaTimestamps = 10, mintAmount = avaxExp(10), borrowAmt = avaxExp(1), borrowIdx = avaxExp(1)
      await send(comptroller.benqi, 'transfer', [comptroller._address, qiRemaining], {from: root});
      let [_,__, ...claimAccts] = saddle.accounts;

      for(let acct of claimAccts) {
        await send(qiLOW, 'harnessIncrementTotalBorrows', [borrowAmt]);
        await send(qiLOW, 'harnessSetAccountBorrows', [acct, borrowAmt, borrowIdx]);
      }
      await send(comptroller, 'harnessAddQiMarkets', [[qiLOW._address]]);
      await send(comptroller, 'harnessRefreshQiSpeeds');

      await send(comptroller, 'harnessFastForward', [10]);

      const tx = await send(comptroller, 'claimQi', [claimAccts, [qiLOW._address], true, false]);
      for(let acct of claimAccts) {
        expect(await call(comptroller, 'qiBorrowerIndex', [qiLOW._address, acct])).toEqualNumber(avaxDouble(2.25));
        expect(await call(comptroller, 'qiSupplierIndex', [qiLOW._address, acct])).toEqualNumber(0);
      }
    });

    it('should revert when a market is not listed', async () => {
      const qiNOT = await makeQiToken({comptroller});
      await expect(
        send(comptroller, 'claimQi', [[a1, a2], [qiNOT._address], true, true])
      ).rejects.toRevert('revert market must be listed');
    });
  });

  describe('harnessRefreshQiSpeeds', () => {
    it('should start out 0', async () => {
      await send(comptroller, 'harnessRefreshQiSpeeds');
      const speed = await call(comptroller, 'qiSpeeds', [qiLOW._address]);
      expect(speed).toEqualNumber(0);
    });

    it('should get correct speeds with borrows', async () => {
      await pretendBorrow(qiLOW, a1, 1, 1, 100);
      await send(comptroller, 'harnessAddQiMarkets', [[qiLOW._address]]);
      const tx = await send(comptroller, 'harnessRefreshQiSpeeds');
      const speed = await call(comptroller, 'qiSpeeds', [qiLOW._address]);
      expect(speed).toEqualNumber(qiRate);
      expect(tx).toHaveLog(['QiSpeedUpdated', 0], {
        qiToken: qiLOW._address,
        newSpeed: speed
      });
    });

    it('should get correct speeds for 2 assets', async () => {
      await pretendBorrow(qiLOW, a1, 1, 1, 100);
      await pretendBorrow(qiZRX, a1, 1, 1, 100);
      await send(comptroller, 'harnessAddQiMarkets', [[qiLOW._address, qiZRX._address]]);
      await send(comptroller, 'harnessRefreshQiSpeeds');
      const speed1 = await call(comptroller, 'qiSpeeds', [qiLOW._address]);
      const speed2 = await call(comptroller, 'qiSpeeds', [qiREP._address]);
      const speed3 = await call(comptroller, 'qiSpeeds', [qiZRX._address]);
      expect(speed1).toEqualNumber(qiRate.dividedBy(4));
      expect(speed2).toEqualNumber(0);
      expect(speed3).toEqualNumber(qiRate.dividedBy(4).multipliedBy(3));
    });
  });

  describe('harnessAddQiMarkets', () => {
    it('should correctly add a benqi market if called by admin', async () => {
      const qiBAT = await makeQiToken({comptroller, supportMarket: true});
      const tx1 = await send(comptroller, 'harnessAddQiMarkets', [[qiLOW._address, qiREP._address, qiZRX._address]]);
      const tx2 = await send(comptroller, 'harnessAddQiMarkets', [[qiBAT._address]]);
      const markets = await call(comptroller, 'getQiMarkets');
      expect(markets).toEqual([qiLOW, qiREP, qiZRX, qiBAT].map((c) => c._address));
      expect(tx2).toHaveLog('QiSpeedUpdated', {
        qiToken: qiBAT._address,
        newSpeed: 1
      });
    });

    it('should not write over a markets existing state', async () => {
      const mkt = qiLOW._address;
      const bn0 = 10, bn1 = 20;
      const idx = avaxUnsigned(1.5e36);

      await send(comptroller, "harnessAddQiMarkets", [[mkt]]);
      await send(comptroller, "setQiSupplyState", [mkt, idx, bn0]);
      await send(comptroller, "setQiBorrowState", [mkt, idx, bn0]);
      await send(comptroller, "setBlockTimestamp", [bn1]);
      await send(comptroller, "_setQiSpeed", [mkt, 0]);
      await send(comptroller, "harnessAddQiMarkets", [[mkt]]);

      const supplyState = await call(comptroller, 'qiSupplyState', [mkt]);
      expect(supplyState.timestamp).toEqual(bn1.toString());
      expect(supplyState.index).toEqual(idx.toFixed());

      const borrowState = await call(comptroller, 'qiBorrowState', [mkt]);
      expect(borrowState.timestamp).toEqual(bn1.toString());
      expect(borrowState.index).toEqual(idx.toFixed());
    });
  });


  describe('updateContributorRewards', () => {
    it('should not fail when contributor rewards called on non-contributor', async () => {
      const tx1 = await send(comptroller, 'updateContributorRewards', [a1]);
    });

    it('should accrue benqi to contributors', async () => {
      const tx1 = await send(comptroller, '_setContributorQiSpeed', [a1, 2000]);
      await fastForward(comptroller, 50);

      const a1Accrued = await qiAccrued(comptroller, a1);
      expect(a1Accrued).toEqualNumber(0);

      const tx2 = await send(comptroller, 'updateContributorRewards', [a1], {from: a1});
      const a1Accrued2 = await qiAccrued(comptroller, a1);
      expect(a1Accrued2).toEqualNumber(50 * 2000);
    });

    it('should accrue benqi with late set', async () => {
      await fastForward(comptroller, 1000);
      const tx1 = await send(comptroller, '_setContributorQiSpeed', [a1, 2000]);
      await fastForward(comptroller, 50);

      const tx2 = await send(comptroller, 'updateContributorRewards', [a1], {from: a1});
      const a1Accrued2 = await qiAccrued(comptroller, a1);
      expect(a1Accrued2).toEqualNumber(50 * 2000);
    });
  });

  describe('_setContributorQiSpeed', () => {
    it('should revert if not called by admin', async () => {
      await expect(
        send(comptroller, '_setContributorQiSpeed', [a1, 1000], {from: a1})
      ).rejects.toRevert('revert only admin can set benqi speed');
    });

    it('should start benqi stream if called by admin', async () => {
      const tx = await send(comptroller, '_setContributorQiSpeed', [a1, 1000]);
      expect(tx).toHaveLog('ContributorQiSpeedUpdated', {
        contributor: a1,
        newSpeed: 1000
      });
    });

    it('should reset benqi stream if set to 0', async () => {
      const tx1 = await send(comptroller, '_setContributorQiSpeed', [a1, 2000]);
      await fastForward(comptroller, 50);

      const tx2 = await send(comptroller, '_setContributorQiSpeed', [a1, 0]);
      await fastForward(comptroller, 50);

      const tx3 = await send(comptroller, 'updateContributorRewards', [a1], {from: a1});
      const a1Accrued = await qiAccrued(comptroller, a1);
      expect(a1Accrued).toEqualNumber(50 * 2000);
    });
  });
});
