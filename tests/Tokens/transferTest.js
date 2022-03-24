const {makeQiToken} = require('../Utils/Benqi');

describe('QiToken', function () {
  let root, accounts;
  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
  });

  describe('transfer', () => {
    it("cannot transfer from a zero balance", async () => {
      const qiToken = await makeQiToken({supportMarket: true});
      expect(await call(qiToken, 'balanceOf', [root])).toEqualNumber(0);
      expect(await send(qiToken, 'transfer', [accounts[0], 100])).toHaveTokenFailure('MATH_ERROR', 'TRANSFER_NOT_ENOUGH');
    });

    it("transfers 50 tokens", async () => {
      const qiToken = await makeQiToken({supportMarket: true});
      await send(qiToken, 'harnessSetBalance', [root, 100]);
      expect(await call(qiToken, 'balanceOf', [root])).toEqualNumber(100);
      await send(qiToken, 'transfer', [accounts[0], 50]);
      expect(await call(qiToken, 'balanceOf', [root])).toEqualNumber(50);
      expect(await call(qiToken, 'balanceOf', [accounts[0]])).toEqualNumber(50);
    });

    it("doesn't transfer when src == dst", async () => {
      const qiToken = await makeQiToken({supportMarket: true});
      await send(qiToken, 'harnessSetBalance', [root, 100]);
      expect(await call(qiToken, 'balanceOf', [root])).toEqualNumber(100);
      expect(await send(qiToken, 'transfer', [root, 50])).toHaveTokenFailure('BAD_INPUT', 'TRANSFER_NOT_ALLOWED');
    });

    it("rejects transfer when not allowed and reverts if not verified", async () => {
      const qiToken = await makeQiToken({comptrollerOpts: {kind: 'bool'}});
      await send(qiToken, 'harnessSetBalance', [root, 100]);
      expect(await call(qiToken, 'balanceOf', [root])).toEqualNumber(100);

      await send(qiToken.comptroller, 'setTransferAllowed', [false])
      expect(await send(qiToken, 'transfer', [root, 50])).toHaveTrollReject('TRANSFER_COMPTROLLER_REJECTION');

      await send(qiToken.comptroller, 'setTransferAllowed', [true])
      await send(qiToken.comptroller, 'setTransferVerify', [false])
      // no longer support verifyTransfer on qiToken end
      // await expect(send(qiToken, 'transfer', [accounts[0], 50])).rejects.toRevert("revert transferVerify rejected transfer");
    });
  });
});