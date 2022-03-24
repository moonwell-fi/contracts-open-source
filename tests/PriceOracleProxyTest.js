const BigNumber = require('bignumber.js');

const {
  address,
  avaxMantissa
} = require('./Utils/Avalanche');

const {
  makeQiToken,
  makePriceOracle,
} = require('./Utils/Benqi');

describe('PriceOracleProxy', () => {
  let root, accounts;
  let oracle, backingOracle, qiAvax, qiUsdc, qiSai, qiDai, qiUsdt, cOther;
  let daiOracleKey = address(2);

  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
    qiAvax = await makeQiToken({kind: "qiavax", comptrollerOpts: {kind: "v1-no-proxy"}, supportMarket: true});
    qiUsdc = await makeQiToken({comptroller: qiAvax.comptroller, supportMarket: true});
    qiSai = await makeQiToken({comptroller: qiAvax.comptroller, supportMarket: true});
    qiDai = await makeQiToken({comptroller: qiAvax.comptroller, supportMarket: true});
    qiUsdt = await makeQiToken({comptroller: qiAvax.comptroller, supportMarket: true});
    cOther = await makeQiToken({comptroller: qiAvax.comptroller, supportMarket: true});

    backingOracle = await makePriceOracle();
    oracle = await deploy('PriceOracleProxy',
      [
        root,
        backingOracle._address,
        qiAvax._address,
        qiUsdc._address,
        qiSai._address,
        qiDai._address,
        qiUsdt._address
      ]
     );
  });

  describe("constructor", () => {
    it("sets address of guardian", async () => {
      let configuredGuardian = await call(oracle, "guardian");
      expect(configuredGuardian).toEqual(root);
    });

    it("sets address of v1 oracle", async () => {
      let configuredOracle = await call(oracle, "v1PriceOracle");
      expect(configuredOracle).toEqual(backingOracle._address);
    });

    it("sets address of qiAvax", async () => {
      let configuredQiAvax = await call(oracle, "qiAvaxAddress");
      expect(configuredQiAvax).toEqual(qiAvax._address);
    });

    it("sets address of qiUSDC", async () => {
      let configuredCUSD = await call(oracle, "qiUsdcAddress");
      expect(configuredCUSD).toEqual(qiUsdc._address);
    });

    it("sets address of qiSAI", async () => {
      let configuredQISAI = await call(oracle, "qiSaiAddress");
      expect(configuredQISAI).toEqual(qiSai._address);
    });

    it("sets address of qiDAI", async () => {
      let configuredQIDAI = await call(oracle, "qiDaiAddress");
      expect(configuredQIDAI).toEqual(qiDai._address);
    });

    it("sets address of qiUSDT", async () => {
      let configuredQIUSDT = await call(oracle, "qiUsdtAddress");
      expect(configuredQIUSDT).toEqual(qiUsdt._address);
    });
  });

  describe("getUnderlyingPrice", () => {
    let setAndVerifyBackingPrice = async (qiToken, price) => {
      await send(
        backingOracle,
        "setUnderlyingPrice",
        [qiToken._address, avaxMantissa(price)]);

      let backingOraclePrice = await call(
        backingOracle,
        "assetPrices",
        [qiToken.underlying._address]);

      expect(Number(backingOraclePrice)).toEqual(price * 1e18);
    };

    let readAndVerifyProxyPrice = async (token, price) =>{
      let proxyPrice = await call(oracle, "getUnderlyingPrice", [token._address]);
      expect(Number(proxyPrice)).toEqual(price * 1e18);;
    };

    it("always returns 1e18 for qiAvax", async () => {
      await readAndVerifyProxyPrice(qiAvax, 1);
    });

    it("uses address(1) for USDC and address(2) for qidai", async () => {
      await send(backingOracle, "setDirectPrice", [address(1), avaxMantissa(5e12)]);
      await send(backingOracle, "setDirectPrice", [address(2), avaxMantissa(8)]);
      await readAndVerifyProxyPrice(qiDai, 8);
      await readAndVerifyProxyPrice(qiUsdc, 5e12);
      await readAndVerifyProxyPrice(qiUsdt, 5e12);
    });

    it("proxies for whitelisted tokens", async () => {
      await setAndVerifyBackingPrice(cOther, 11);
      await readAndVerifyProxyPrice(cOther, 11);

      await setAndVerifyBackingPrice(cOther, 37);
      await readAndVerifyProxyPrice(cOther, 37);
    });

    it("returns 0 for token without a price", async () => {
      let unlistedToken = await makeQiToken({comptroller: qiAvax.comptroller});

      await readAndVerifyProxyPrice(unlistedToken, 0);
    });

    it("correctly handle setting SAI price", async () => {
      await send(backingOracle, "setDirectPrice", [daiOracleKey, avaxMantissa(0.01)]);

      await readAndVerifyProxyPrice(qiDai, 0.01);
      await readAndVerifyProxyPrice(qiSai, 0.01);

      await send(oracle, "setSaiPrice", [avaxMantissa(0.05)]);

      await readAndVerifyProxyPrice(qiDai, 0.01);
      await readAndVerifyProxyPrice(qiSai, 0.05);

      await expect(send(oracle, "setSaiPrice", [1])).rejects.toRevert("revert SAI price may only be set once");
    });

    it("only guardian may set the sai price", async () => {
      await expect(send(oracle, "setSaiPrice", [1], {from: accounts[0]})).rejects.toRevert("revert only guardian may set the SAI price");
    });

    it("sai price must be bounded", async () => {
      await expect(send(oracle, "setSaiPrice", [avaxMantissa(10)])).rejects.toRevert("revert SAI price must be < 0.1 AVAX");
    });
});
});
