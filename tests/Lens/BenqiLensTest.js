const {
  address,
  encodeParameters,
} = require('../Utils/Avalanche');
const {
  makeComptroller,
  makeQiToken,
} = require('../Utils/Benqi');

function cullTuple(tuple) {
  return Object.keys(tuple).reduce((acc, key) => {
    if (Number.isNaN(Number(key))) {
      return {
        ...acc,
        [key]: tuple[key]
      };
    } else {
      return acc;
    }
  }, {});
}

describe('BenqiLens', () => {
  let benqiLens;
  let acct;

  beforeEach(async () => {
    benqiLens = await deploy('BenqiLens');
    acct = accounts[0];
  });

  describe('qiTokenMetadata', () => {
    it('is correct for a qiErc20', async () => {
      let qiErc20 = await makeQiToken();
      expect(
        cullTuple(await call(benqiLens, 'qiTokenMetadata', [qiErc20._address]))
      ).toEqual(
        {
          qiToken: qiErc20._address,
          exchangeRateCurrent: "1000000000000000000",
          supplyRatePerTimestamp: "0",
          borrowRatePerTimestamp: "0",
          reserveFactorMantissa: "0",
          totalBorrows: "0",
          totalReserves: "0",
          totalSupply: "0",
          totalCash: "0",
          isListed:false,
          collateralFactorMantissa: "0",
          underlyingAssetAddress: await call(qiErc20, 'underlying', []),
          qiTokenDecimals: "8",
          underlyingDecimals: "18"
        }
      );
    });

    it('is correct for qiAvax', async () => {
      let qiAvax = await makeQiToken({kind: 'qiavax'});
      expect(
        cullTuple(await call(benqiLens, 'qiTokenMetadata', [qiAvax._address]))
      ).toEqual({
        borrowRatePerTimestamp: "0",
        qiToken: qiAvax._address,
        qiTokenDecimals: "8",
        collateralFactorMantissa: "0",
        exchangeRateCurrent: "1000000000000000000",
        isListed: false,
        reserveFactorMantissa: "0",
        supplyRatePerTimestamp: "0",
        totalBorrows: "0",
        totalCash: "0",
        totalReserves: "0",
        totalSupply: "0",
        underlyingAssetAddress: "0x0000000000000000000000000000000000000000",
        underlyingDecimals: "18",
      });
    });
  });

  describe('qiTokenMetadataAll', () => {
    it('is correct for a qiErc20 and qiAvax', async () => {
      let qiErc20 = await makeQiToken();
      let qiAvax = await makeQiToken({kind: 'qiavax'});
      expect(
        (await call(benqiLens, 'qiTokenMetadataAll', [[qiErc20._address, qiAvax._address]])).map(cullTuple)
      ).toEqual([
        {
          qiToken: qiErc20._address,
          exchangeRateCurrent: "1000000000000000000",
          supplyRatePerTimestamp: "0",
          borrowRatePerTimestamp: "0",
          reserveFactorMantissa: "0",
          totalBorrows: "0",
          totalReserves: "0",
          totalSupply: "0",
          totalCash: "0",
          isListed:false,
          collateralFactorMantissa: "0",
          underlyingAssetAddress: await call(qiErc20, 'underlying', []),
          qiTokenDecimals: "8",
          underlyingDecimals: "18"
        },
        {
          borrowRatePerTimestamp: "0",
          qiToken: qiAvax._address,
          qiTokenDecimals: "8",
          collateralFactorMantissa: "0",
          exchangeRateCurrent: "1000000000000000000",
          isListed: false,
          reserveFactorMantissa: "0",
          supplyRatePerTimestamp: "0",
          totalBorrows: "0",
          totalCash: "0",
          totalReserves: "0",
          totalSupply: "0",
          underlyingAssetAddress: "0x0000000000000000000000000000000000000000",
          underlyingDecimals: "18",
        }
      ]);
    });
  });

  describe('qiTokenBalances', () => {
    it('is correct for qiERC20', async () => {
      let qiErc20 = await makeQiToken();
      expect(
        cullTuple(await call(benqiLens, 'qiTokenBalances', [qiErc20._address, acct]))
      ).toEqual(
        {
          balanceOf: "0",
          balanceOfUnderlying: "0",
          borrowBalanceCurrent: "0",
          qiToken: qiErc20._address,
          tokenAllowance: "0",
          tokenBalance: "10000000000000000000000000",
        }
      );
    });

    it('is correct for qiAVAX', async () => {
      let qiAvax = await makeQiToken({kind: 'qiavax'});
      let ethBalance = await web3.eth.getBalance(acct);
      expect(
        cullTuple(await call(benqiLens, 'qiTokenBalances', [qiAvax._address, acct], {gasPrice: '0'}))
      ).toEqual(
        {
          balanceOf: "0",
          balanceOfUnderlying: "0",
          borrowBalanceCurrent: "0",
          qiToken: qiAvax._address,
          tokenAllowance: ethBalance,
          tokenBalance: ethBalance,
        }
      );
    });
  });

  describe('qiTokenBalancesAll', () => {
    it('is correct for qiAvax and qiErc20', async () => {
      let qiErc20 = await makeQiToken();
      let qiAvax = await makeQiToken({kind: 'qiavax'});
      let ethBalance = await web3.eth.getBalance(acct);
      
      expect(
        (await call(benqiLens, 'qiTokenBalancesAll', [[qiErc20._address, qiAvax._address], acct], {gasPrice: '0'})).map(cullTuple)
      ).toEqual([
        {
          balanceOf: "0",
          balanceOfUnderlying: "0",
          borrowBalanceCurrent: "0",
          qiToken: qiErc20._address,
          tokenAllowance: "0",
          tokenBalance: "10000000000000000000000000",
        },
        {
          balanceOf: "0",
          balanceOfUnderlying: "0",
          borrowBalanceCurrent: "0",
          qiToken: qiAvax._address,
          tokenAllowance: ethBalance,
          tokenBalance: ethBalance,
        }
      ]);
    })
  });

  describe('qiTokenUnderlyingPrice', () => {
    it('gets correct price for qiErc20', async () => {
      let qiErc20 = await makeQiToken();
      expect(
        cullTuple(await call(benqiLens, 'qiTokenUnderlyingPrice', [qiErc20._address]))
      ).toEqual(
        {
          qiToken: qiErc20._address,
          underlyingPrice: "0",
        }
      );
    });

    it('gets correct price for qiAvax', async () => {
      let qiAvax = await makeQiToken({kind: 'qiavax'});
      expect(
        cullTuple(await call(benqiLens, 'qiTokenUnderlyingPrice', [qiAvax._address]))
      ).toEqual(
        {
          qiToken: qiAvax._address,
          underlyingPrice: "1000000000000000000",
        }
      );
    });
  });

  describe('qiTokenUnderlyingPriceAll', () => {
    it('gets correct price for both', async () => {
      let qiErc20 = await makeQiToken();
      let qiAvax = await makeQiToken({kind: 'qiavax'});
      expect(
        (await call(benqiLens, 'qiTokenUnderlyingPriceAll', [[qiErc20._address, qiAvax._address]])).map(cullTuple)
      ).toEqual([
        {
          qiToken: qiErc20._address,
          underlyingPrice: "0",
        },
        {
          qiToken: qiAvax._address,
          underlyingPrice: "1000000000000000000",
        }
      ]);
    });
  });

  describe('getAccountLimits', () => {
    it('gets correct values', async () => {
      let comptroller = await makeComptroller();

      expect(
        cullTuple(await call(benqiLens, 'getAccountLimits', [comptroller._address, acct]))
      ).toEqual({
        liquidity: "0",
        markets: [],
        shortfall: "0"
      });
    });
  });

  describe('governance', () => {
    let benqi, gov;
    let targets, values, signatures, callDatas;
    let proposalBlock, proposalId;

    beforeEach(async () => {
      benqi = await deploy('Benqi', [acct]);
      gov = await deploy('GovernorAlpha', [address(0), benqi._address, address(0)]);
      targets = [acct];
      values = ["0"];
      signatures = ["getBalanceOf(address)"];
      callDatas = [encodeParameters(['address'], [acct])];
      await send(benqi, 'delegate', [acct]);
      await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"]);
      proposalBlock = +(await web3.eth.getBlockNumber());
      proposalId = await call(gov, 'latestProposalIds', [acct]);
    });

    describe('getGovReceipts', () => {
      it('gets correct values', async () => {
        expect(
          (await call(benqiLens, 'getGovReceipts', [gov._address, acct, [proposalId]])).map(cullTuple)
        ).toEqual([
          {
            hasVoted: false,
            proposalId: proposalId,
            support: false,
            votes: "0",
          }
        ]);
      })
    });

    describe('getGovProposals', () => {
      it('gets correct values', async () => {
        expect(
          (await call(benqiLens, 'getGovProposals', [gov._address, [proposalId]])).map(cullTuple)
        ).toEqual([
          {
            againstVotes: "0",
            calldatas: callDatas,
            canceled: false,
            endBlock: (Number(proposalBlock) + 17281).toString(),
            eta: "0",
            executed: false,
            forVotes: "0",
            proposalId: proposalId,
            proposer: acct,
            signatures: signatures,
            startBlock: (Number(proposalBlock) + 1).toString(),
            targets: targets
          }
        ]);
      })
    });
  });

  describe('benqi', () => {
    let benqi, currentBlock;

    beforeEach(async () => {
      currentBlock = +(await web3.eth.getBlockNumber());
      benqi = await deploy('Benqi', [acct]);
    });

    describe('getQiBalanceMetadata', () => {
      it('gets correct values', async () => {
        expect(
          cullTuple(await call(benqiLens, 'getQiBalanceMetadata', [benqi._address, acct]))
        ).toEqual({
          balance: "7200000000000000000000000000",
          delegate: "0x0000000000000000000000000000000000000000",
          votes: "0",
        });
      });
    });

    describe('getQiBalanceMetadataExt', () => {
      it('gets correct values', async () => {
        let comptroller = await makeComptroller();
        await send(comptroller, 'setQiAccrued', [acct, 5]); // harness only

        expect(
          cullTuple(await call(benqiLens, 'getQiBalanceMetadataExt', [benqi._address, comptroller._address, acct]))
        ).toEqual({
          balance: "7200000000000000000000000000",
          delegate: "0x0000000000000000000000000000000000000000",
          votes: "0",
          allocated: "5"
        });
      });
    });

    describe('getQiVotes', () => {
      it('gets correct values', async () => {
        expect(
          (await call(benqiLens, 'getQiVotes', [benqi._address, acct, [currentBlock, currentBlock - 1]])).map(cullTuple)
        ).toEqual([
          {
            blockTimestamp: currentBlock.toString(),
            votes: "0",
          },
          {
            blockTimestamp: (Number(currentBlock) - 1).toString(),
            votes: "0",
          }
        ]);
      });

      it('reverts on future value', async () => {
        await expect(
          call(benqiLens, 'getQiVotes', [benqi._address, acct, [currentBlock + 1]])
        ).rejects.toRevert('revert Benqi::getPriorVotes: not yet determined')
      });
    });
  });
});
