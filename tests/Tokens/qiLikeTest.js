const {
  makeQiToken,
} = require('../Utils/Benqi');


describe('QiQiLikeDelegate', function () {
  describe("_delegateQiLikeTo", () => {
    it("does not delegate if not the admin", async () => {
      const [root, a1] = saddle.accounts;
      const qiToken = await makeQiToken({kind: 'qiqi'});
      await expect(send(qiToken, '_delegateQiLikeTo', [a1], {from: a1})).rejects.toRevert('revert only the admin may set the benqi-like delegate');
    });

    it("delegates successfully if the admin", async () => {
      const [root, a1] = saddle.accounts, amount = 1;
      const qiQI = await makeQiToken({kind: 'qiqi'}), BENQI = qiQI.underlying;
      const tx1 = await send(qiQI, '_delegateQiLikeTo', [a1]);
      const tx2 = await send(BENQI, 'transfer', [qiQI._address, amount]);
      await expect(await call(BENQI, 'getCurrentVotes', [a1])).toEqualNumber(amount);
    });
  });
});