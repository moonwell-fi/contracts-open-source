require('dotenv').config()
const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
  networks: {
    fuji: {
      provider: () => new HDWalletProvider({
        providerOrUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
        chainId: '0xa869',
        privateKeys: [
          process.env.PRIVATE_KEY,
        ],
      }),
      network_id: '*',
      gas: 3000000,
      gasPrice: 225000000000,
    },
  },
  compilers: {
    solc: {
      version: '0.5.17',
      settings: {
        optimizer: {
          enabled: true,
          runs: 1,
        },
        evmVersion: 'istanbul',
      },
    },
  },
};
