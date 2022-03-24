const {
  avaxBalance,
  avaxGasCost,
  getContract
} = require('./Utils/Avalanche');

const {
  makeComptroller,
  makeQiToken,
  makePriceOracle,
  pretendBorrow,
  borrowSnapshot
} = require('./Utils/Benqi');

describe('Maximillion', () => {
  let root, borrower;
  let maximillion, qiAvax;
  beforeEach(async () => {
    [root, borrower] = saddle.accounts;
    qiAvax = await makeQiToken({kind: "qiavax", supportMarket: true});
    maximillion = await deploy('Maximillion', [qiAvax._address]);
  });

  describe("constructor", () => {
    it("sets address of qiAvax", async () => {
      expect(await call(maximillion, "qiAvax")).toEqual(qiAvax._address);
    });
  });

  describe("repayBehalf", () => {
    it("refunds the entire amount with no borrows", async () => {
      const beforeBalance = await avaxBalance(root);
      const result = await send(maximillion, "repayBehalf", [borrower], {value: 100});
      const gasCost = await avaxGasCost(result);
      const afterBalance = await avaxBalance(root);
      expect(result).toSucceed();
      expect(afterBalance).toEqualNumber(beforeBalance.minus(gasCost));
    });

    it("repays part of a borrow", async () => {
      await pretendBorrow(qiAvax, borrower, 1, 1, 150);
      const beforeBalance = await avaxBalance(root);
      const result = await send(maximillion, "repayBehalf", [borrower], {value: 100});
      const gasCost = await avaxGasCost(result);
      const afterBalance = await avaxBalance(root);
      const afterBorrowSnap = await borrowSnapshot(qiAvax, borrower);
      expect(result).toSucceed();
      expect(afterBalance).toEqualNumber(beforeBalance.minus(gasCost).minus(100));
      expect(afterBorrowSnap.principal).toEqualNumber(50);
    });

    it("repays a full borrow and refunds the rest", async () => {
      await pretendBorrow(qiAvax, borrower, 1, 1, 90);
      const beforeBalance = await avaxBalance(root);
      const result = await send(maximillion, "repayBehalf", [borrower], {value: 100});
      const gasCost = await avaxGasCost(result);
      const afterBalance = await avaxBalance(root);
      const afterBorrowSnap = await borrowSnapshot(qiAvax, borrower);
      expect(result).toSucceed();
      expect(afterBalance).toEqualNumber(beforeBalance.minus(gasCost).minus(90));
      expect(afterBorrowSnap.principal).toEqualNumber(0);
    });
  });
});
