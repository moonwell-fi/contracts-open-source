Moonwell Protocol
=================

The Moonwell Protocol is an Polkadot (Moonriver & Moonbeam) smart contract for supplying or borrowing assets. Through the mToken contracts, accounts on the blockchain *supply* capital (MOVR/GLMR or ERC-20 tokens) to receive mTokens to track their positions, or *borrow* assets from the protocol (holding other assets on-platform as collateral). The Moonwell mToken contracts track these balances and algorithmically set interest rates for borrowers & lenders.

Contracts
=========

We detail a few of the core contracts in the Moonwell Protocol.

<dl>
  <dt>mToken, mErc20 and mGLMR</dt>
  <dd>The Moonwell mTokens, which are self-contained borrowing and lending contracts. mToken contains the core logic and mErc20 and mGLMR add public interfaces for Erc20 tokens and avax, respectively. Each mToken is assigned an interest rate and risk model (see InterestRateModel and Comptroller sections), and allows accounts to *mint* mTokens (supply capital), *redeem* mTokens (withdraw capital), *borrow* MOVR/GLMR/ERC20 Tokens and *repay a borrow*. Each mToken is an ERC-20 compliant token where balances represent ownership of the market as a whole.</dd>
</dl>

<dl>
  <dt>Comptroller</dt>
  <dd>The risk model contract, which validates permissible user actions and disallows actions if they do not fit certain risk parameters. For instance, the Comptroller enforces that each borrowing user must maintain a sufficient collateral balance across all mTokens, or the position can be liqudiated.</dd>
</dl>

<dl>
  <dt>Moonwell</dt>
  <dd>The Moonwell Governance Token (WELL). Holders of this token have the ability to govern the protocol via the governor contract.</dd>
</dl>

<dl>
  <dt>Governor Alpha</dt>
  <dd>The administrator of the Moonwell timelock contract. Holders of Moonwell token may create and vote on proposals which will be queued into the Moonwell timelock and then have effects on Moonwell mToken and Comptroller contracts. This contract may be replaced in the future with a beta version.</dd>
</dl>

<dl>
  <dt>InterestRateModel</dt>
  <dd>Contracts which define interest rate models. These models algorithmically determine interest rates based on the current utilization of a given market (that is, how much of the supplied assets are liquid versus borrowed).</dd>
</dl>

<dl>
  <dt>Careful Math</dt>
  <dd>Based on OpenZeppelin's SafeMath, the CarefulMath Library returns errors instead of reverting.</dd>
</dl>

<dl>
  <dt>ErrorReporter</dt>
  <dd>Library for tracking error codes and failure conditions.</dd>
</dl>

<dl>
  <dt>Exponential</dt>
  <dd>Library for handling fixed-point decimal numbers.</dd>
</dl>

<dl>
  <dt>SafeToken</dt>
  <dd>Library for safely handling Erc20 interaction.</dd>
</dl>

<dl>
  <dt>WhitePaperInterestRateModel</dt>
  <dd>Initial interest rate model, as defined in the Compound Whitepaper. This contract accepts a base rate and slope parameter in its constructor.</dd>
</dl>

Installation
------------
To run Moonwell, pull the repository from GitHub and install its dependencies. You will need [yarn](https://yarnpkg.com/lang/en/docs/install/) or [npm](https://docs.npmjs.com/cli/install) installed.

    git clone https://github.com/moonwell-fi/moonwell-core
    cd moonwell-protocol
    yarn install --lock-file # or `npm install`

REPL
----

The Moonwell Protocol has a simple scenario evaluation tool to test and evaluate scenarios which could occur on the blockchain. This is primarily used for constructing high-level integration tests. The tool also has a REPL to interact with local the Moonwell Protocol (similar to `truffle console`).

    yarn repl -n testnet

    > Read mToken mMOVR Address
    Command: Read mToken mMOVR Address
    AddressV<val=0xAD53863b864AE703D31b819d29c14cDA93D7c6a6>

You can read more about the scenario runner in the [Scenario Docs](https://github.com/moonwell-fi/moonwell-core/tree/master/scenario/SCENARIO.md) on steps for using the repl.

Testing
-------
Jest contract tests are defined under the [tests directory](https://github.com/moonwell-fi/moonwell-core/tree/master/tests). To run the tests run:

    yarn test

Integration Specs
-----------------

There are additional tests under the [spec/scenario](https://github.com/moonwell-fi/moonwell-core/tree/master/spec/scenario) folder. These are high-level integration tests based on the scenario runner depicted above. The aim of these tests is to be highly literate and have high coverage in the interaction of contracts.

Code Coverage
-------------
To run code coverage, run:

    yarn coverage

Linting
-------
To lint the code, run:

    yarn lint

Docker
------

To run in docker:

    # Build the docker image
    docker build -t moonwell-protocol .

    # Run a shell to the built image
    docker run -it moonwell-protocol /bin/sh

From within a docker shell, you can interact locally with the protocol via ganache and truffle:

```bash
    /moonwell-protocol > yarn console -n testnet
    Using network testnet https://rpc.api.moonbase.moonbeam.network
    Saddle console on network goerli https://rpc.api.moonbase.moonbeam.network
    Deployed testnet contracts
      comptroller: 0x627EA49279FD0dE89186A58b8758aD02B6Be2867
      moonwell: 0xfa5E1B628EFB17C024ca76f65B45Faf6B3128CA5
      governorAlpha: 0x8C3969Dd514B559D78135e9C210F2F773Feadf21
      maximillion: 0x73d3F01b8aC5063f4601C7C45DA5Fdf1b5240C92
      priceOracle: 0x9A536Ed5C97686988F93C9f7C2A390bF3B59c0ec
      priceOracleProxy: 0xd0c84453b3945cd7e84BF7fc53BfFd6718913B71
      timelock: 0x25e46957363e16C4e2D5F2854b062475F9f8d287
      unitroller: 0x627EA49279FD0dE89186A58b8758aD02B6Be2867

    > await Moonwell.methods.totalSupply().call()
    '7200000000000000000000000000'
```

Console
-------

After you deploy, as above, you can run a truffle console with the following command:

    yarn console -n testnet

This command will start a saddle console conencted to Moonbase Alpha testnet (see [Saddle README](https://github.com/moonwell-fi/saddle#cli)):

```javascript
    Using network testnet https://rpc.api.moonbase.moonbeam.network
    Saddle console on network testnet https://rpc.api.moonbase.moonbeam.network
    Deployed testnet contracts
      comptroller: 0x627EA49279FD0dE89186A58b8758aD02B6Be2867
      moonwell: 0xfa5E1B628EFB17C024ca76f65B45Faf6B3128CA5
      governorAlpha: 0x8C3969Dd514B559D78135e9C210F2F773Feadf21
      maximillion: 0x73d3F01b8aC5063f4601C7C45DA5Fdf1b5240C92
      priceOracle: 0x9A536Ed5C97686988F93C9f7C2A390bF3B59c0ec
      priceOracleProxy: 0xd0c84453b3945cd7e84BF7fc53BfFd6718913B71
      timelock: 0x25e46957363e16C4e2D5F2854b062475F9f8d287
      unitroller: 0x627EA49279FD0dE89186A58b8758aD02B6Be2867
    > await moonwell.methods.totalSupply().call()
    '7200000000000000000000000000'
```

Deploying a mToken from Source
------------------------------

Note: you will need to set `~/.ethereum/<network>` with your private key or assign your private key to the environment variable `ACCOUNT`.

Note: for all sections including Avaxscan verification, you must set the `MOONSCAN_API_KEY` to a valid API Key from [Moonscan](https://moonscan.io/apis).

To deploy a new mToken, you can run the `token:deploy`. command, as follows. If you set `VERIFY=true`, the script will verify the token on Moonscan as well. The JSON here is the token config JSON, which should be specific to the token you wish to list.

```bash
npx saddle -n testnet script token:deploy '{
  "underlying": "0x577D296678535e4903D59A4C929B718e1D575e0A",
  "comptroller": "$Comptroller",
  "interestRateModel": "$Base200bps_Slope3000bps",
  "initialExchangeRateMantissa": "2.0e18",
  "name": "Moonwell USDC",
  "symbol": "mUSDC",
  "decimals": "18",
  "admin": "$Timelock"
}'
```

If you only want to verify an existing token an Moonscan, make sure `MOONSCAN_API_KEY` is set and run `token:verify` with the first argument as the token address and the second as the token config JSON:

```bash
npx saddle -n testnet script token:verify 0x19B674715cD20626415C738400FDd0d32D6809B6 '{
  "underlying": "0x577D296678535e4903D59A4C929B718e1D575e0A",
  "comptroller": "$Comptroller",
  "interestRateModel": "$Base200bps_Slope3000bps",
  "initialExchangeRateMantissa": "2.0e18",
  "name": "Moonwell USDC",
  "symbol": "mUSDC",
  "decimals": "18",
  "admin": "$Timelock"
}'
```

Finally, to see if a given deployment matches this version of the Moonwell Protocol, you can run `token:match` with a token address and token config:

```bash
npx saddle -n testnet script token:match 0x19B674715cD20626415C738400FDd0d32D6809B6 '{
  "underlying": "0x577D296678535e4903D59A4C929B718e1D575e0A",
  "comptroller": "$Comptroller",
  "interestRateModel": "$Base200bps_Slope3000bps",
  "initialExchangeRateMantissa": "2.0e18",
  "name": "Moonwell USDC",
  "symbol": "mUSDC",
  "decimals": "18",
  "admin": "$Timelock"
}'
```

## Deploying a mToken from Docker Build
---------------------------------------

To deploy a specific version of the Moonwell Protocol, you can use the `token:deploy` script through Docker:

```bash
docker run --env ETHERSCAN_API_KEY --env VERIFY=true --env ACCOUNT=YOUR_PK_HERE moonwell-fi/moonwell-core:latest npx saddle -n testnet script token:deploy '{
  "underlying": "0x577D296678535e4903D59A4C929B718e1D575e0A",
  "comptroller": "$Comptroller",
  "interestRateModel": "$Base200bps_Slope3000bps",
  "initialExchangeRateMantissa": "2.0e18",
  "name": "Moonwell USDC",
  "symbol": "mUSDC",
  "decimals": "18",
  "admin": "$Timelock"
}'
```

To match a deployed contract against a given version of the Moonwell Protocol, you can run `token:match` through Docker, passing a token address and config:

```bash
docker run --env ACCOUNT=YOUR_PK_HERE moonwell-fi/moonwell-core:latest npx saddle -n testnet script token:match 0xF1BAd36CB247C82Cb4e9C2874374492Afb50d565 '{
  "underlying": "0x577D296678535e4903D59A4C929B718e1D575e0A",
  "comptroller": "$Comptroller",
  "interestRateModel": "$Base200bps_Slope3000bps",
  "initialExchangeRateMantissa": "2.0e18",
  "name": "Moonwell USDC",
  "symbol": "mUSDC",
  "decimals": "18",
  "admin": "$Timelock"
}'
```
