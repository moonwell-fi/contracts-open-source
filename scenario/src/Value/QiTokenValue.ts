import { Event } from '../Event';
import { World } from '../World';
import { QiToken } from '../Contract/QiToken';
import { QiErc20Delegator } from '../Contract/QiErc20Delegator';
import { Erc20 } from '../Contract/Erc20';
import {
  getAddressV,
  getCoreValue,
  getStringV,
  mapValue
} from '../CoreValue';
import { Arg, Fetcher, getFetcherValue } from '../Command';
import {
  AddressV,
  NumberV,
  Value,
  StringV
} from '../Value';
import { getWorldContractByAddress, getQiTokenAddress } from '../ContractLookup';

export async function getQiTokenV(world: World, event: Event): Promise<QiToken> {
  const address = await mapValue<AddressV>(
    world,
    event,
    (str) => new AddressV(getQiTokenAddress(world, str)),
    getCoreValue,
    AddressV
  );

  return getWorldContractByAddress<QiToken>(world, address.val);
}

export async function getQiErc20DelegatorV(world: World, event: Event): Promise<QiErc20Delegator> {
  const address = await mapValue<AddressV>(
    world,
    event,
    (str) => new AddressV(getQiTokenAddress(world, str)),
    getCoreValue,
    AddressV
  );

  return getWorldContractByAddress<QiErc20Delegator>(world, address.val);
}

async function getInterestRateModel(world: World, qiToken: QiToken): Promise<AddressV> {
  return new AddressV(await qiToken.methods.interestRateModel().call());
}

async function qiTokenAddress(world: World, qiToken: QiToken): Promise<AddressV> {
  return new AddressV(qiToken._address);
}

async function getQiTokenAdmin(world: World, qiToken: QiToken): Promise<AddressV> {
  return new AddressV(await qiToken.methods.admin().call());
}

async function getQiTokenPendingAdmin(world: World, qiToken: QiToken): Promise<AddressV> {
  return new AddressV(await qiToken.methods.pendingAdmin().call());
}

async function balanceOfUnderlying(world: World, qiToken: QiToken, user: string): Promise<NumberV> {
  return new NumberV(await qiToken.methods.balanceOfUnderlying(user).call());
}

async function getBorrowBalance(world: World, qiToken: QiToken, user): Promise<NumberV> {
  return new NumberV(await qiToken.methods.borrowBalanceCurrent(user).call());
}

async function getBorrowBalanceStored(world: World, qiToken: QiToken, user): Promise<NumberV> {
  return new NumberV(await qiToken.methods.borrowBalanceStored(user).call());
}

async function getTotalBorrows(world: World, qiToken: QiToken): Promise<NumberV> {
  return new NumberV(await qiToken.methods.totalBorrows().call());
}

async function getTotalBorrowsCurrent(world: World, qiToken: QiToken): Promise<NumberV> {
  return new NumberV(await qiToken.methods.totalBorrowsCurrent().call());
}

async function getReserveFactor(world: World, qiToken: QiToken): Promise<NumberV> {
  return new NumberV(await qiToken.methods.reserveFactorMantissa().call(), 1.0e18);
}

async function getTotalReserves(world: World, qiToken: QiToken): Promise<NumberV> {
  return new NumberV(await qiToken.methods.totalReserves().call());
}

async function getComptroller(world: World, qiToken: QiToken): Promise<AddressV> {
  return new AddressV(await qiToken.methods.comptroller().call());
}

async function getExchangeRateStored(world: World, qiToken: QiToken): Promise<NumberV> {
  return new NumberV(await qiToken.methods.exchangeRateStored().call());
}

async function getExchangeRate(world: World, qiToken: QiToken): Promise<NumberV> {
  return new NumberV(await qiToken.methods.exchangeRateCurrent().call(), 1e18);
}

async function getCash(world: World, qiToken: QiToken): Promise<NumberV> {
  return new NumberV(await qiToken.methods.getCash().call());
}

async function getInterestRate(world: World, qiToken: QiToken): Promise<NumberV> {
  return new NumberV(await qiToken.methods.borrowRatePerTimestamp().call(), 1.0e18 / 31536000);
}

async function getImplementation(world: World, qiToken: QiToken): Promise<AddressV> {
  return new AddressV(await (qiToken as QiErc20Delegator).methods.implementation().call());
}

export function qiTokenFetchers() {
  return [
    new Fetcher<{ qiToken: QiToken }, AddressV>(`
        #### Address

        * "QiToken <QiToken> Address" - Returns address of QiToken contract
          * E.g. "QiToken qiZRX Address" - Returns qiZRX's address
      `,
      "Address",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => qiTokenAddress(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, AddressV>(`
        #### InterestRateModel

        * "QiToken <QiToken> InterestRateModel" - Returns the interest rate model of QiToken contract
          * E.g. "QiToken qiZRX InterestRateModel" - Returns qiZRX's interest rate model
      `,
      "InterestRateModel",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getInterestRateModel(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, AddressV>(`
        #### Admin

        * "QiToken <QiToken> Admin" - Returns the admin of QiToken contract
          * E.g. "QiToken qiZRX Admin" - Returns qiZRX's admin
      `,
      "Admin",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getQiTokenAdmin(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, AddressV>(`
        #### PendingAdmin

        * "QiToken <QiToken> PendingAdmin" - Returns the pending admin of QiToken contract
          * E.g. "QiToken qiZRX PendingAdmin" - Returns qiZRX's pending admin
      `,
      "PendingAdmin",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getQiTokenPendingAdmin(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, AddressV>(`
        #### Underlying

        * "QiToken <QiToken> Underlying" - Returns the underlying asset (if applicable)
          * E.g. "QiToken qiZRX Underlying"
      `,
      "Underlying",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      async (world, { qiToken }) => new AddressV(await qiToken.methods.underlying().call()),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken, address: AddressV }, NumberV>(`
        #### UnderlyingBalance

        * "QiToken <QiToken> UnderlyingBalance <User>" - Returns a user's underlying balance (based on given exchange rate)
          * E.g. "QiToken qiZRX UnderlyingBalance Geoff"
      `,
      "UnderlyingBalance",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg<AddressV>("address", getAddressV)
      ],
      (world, { qiToken, address }) => balanceOfUnderlying(world, qiToken, address.val),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken, address: AddressV }, NumberV>(`
        #### BorrowBalance

        * "QiToken <QiToken> BorrowBalance <User>" - Returns a user's borrow balance (including interest)
          * E.g. "QiToken qiZRX BorrowBalance Geoff"
      `,
      "BorrowBalance",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("address", getAddressV)
      ],
      (world, { qiToken, address }) => getBorrowBalance(world, qiToken, address.val),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken, address: AddressV }, NumberV>(`
        #### BorrowBalanceStored

        * "QiToken <QiToken> BorrowBalanceStored <User>" - Returns a user's borrow balance (without specifically re-accruing interest)
          * E.g. "QiToken qiZRX BorrowBalanceStored Geoff"
      `,
      "BorrowBalanceStored",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("address", getAddressV)
      ],
      (world, { qiToken, address }) => getBorrowBalanceStored(world, qiToken, address.val),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, NumberV>(`
        #### TotalBorrows

        * "QiToken <QiToken> TotalBorrows" - Returns the qiToken's total borrow balance
          * E.g. "QiToken qiZRX TotalBorrows"
      `,
      "TotalBorrows",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getTotalBorrows(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, NumberV>(`
        #### TotalBorrowsCurrent

        * "QiToken <QiToken> TotalBorrowsCurrent" - Returns the qiToken's total borrow balance with interest
          * E.g. "QiToken qiZRX TotalBorrowsCurrent"
      `,
      "TotalBorrowsCurrent",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getTotalBorrowsCurrent(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, NumberV>(`
        #### Reserves

        * "QiToken <QiToken> Reserves" - Returns the qiToken's total reserves
          * E.g. "QiToken qiZRX Reserves"
      `,
      "Reserves",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getTotalReserves(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, NumberV>(`
        #### ReserveFactor

        * "QiToken <QiToken> ReserveFactor" - Returns reserve factor of QiToken contract
          * E.g. "QiToken qiZRX ReserveFactor" - Returns qiZRX's reserve factor
      `,
      "ReserveFactor",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getReserveFactor(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, AddressV>(`
        #### Comptroller

        * "QiToken <QiToken> Comptroller" - Returns the qiToken's comptroller
          * E.g. "QiToken qiZRX Comptroller"
      `,
      "Comptroller",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getComptroller(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, NumberV>(`
        #### ExchangeRateStored

        * "QiToken <QiToken> ExchangeRateStored" - Returns the qiToken's exchange rate (based on balances stored)
          * E.g. "QiToken qiZRX ExchangeRateStored"
      `,
      "ExchangeRateStored",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getExchangeRateStored(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, NumberV>(`
        #### ExchangeRate

        * "QiToken <QiToken> ExchangeRate" - Returns the qiToken's current exchange rate
          * E.g. "QiToken qiZRX ExchangeRate"
      `,
      "ExchangeRate",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getExchangeRate(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, NumberV>(`
        #### Cash

        * "QiToken <QiToken> Cash" - Returns the qiToken's current cash
          * E.g. "QiToken qiZRX Cash"
      `,
      "Cash",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getCash(world, qiToken),
      { namePos: 1 }
    ),

    new Fetcher<{ qiToken: QiToken }, NumberV>(`
        #### InterestRate

        * "QiToken <QiToken> InterestRate" - Returns the qiToken's current interest rate
          * E.g. "QiToken qiZRX InterestRate"
      `,
      "InterestRate",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, {qiToken}) => getInterestRate(world, qiToken),
      {namePos: 1}
    ),
    new Fetcher<{qiToken: QiToken, signature: StringV}, NumberV>(`
        #### CallNum

        * "QiToken <QiToken> Call <signature>" - Simple direct call method, for now with no parameters
          * E.g. "QiToken qiZRX Call \"borrowIndex()\""
      `,
      "CallNum",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("signature", getStringV),
      ],
      async (world, {qiToken, signature}) => {
        const res = await world.web3.eth.call({
            to: qiToken._address,
            data: world.web3.eth.abi.encodeFunctionSignature(signature.val)
          })
        const resNum : any = world.web3.eth.abi.decodeParameter('uint256',res);
        return new NumberV(resNum);
      }
      ,
      {namePos: 1}
    ),
    new Fetcher<{ qiToken: QiToken }, AddressV>(`
        #### Implementation

        * "QiToken <QiToken> Implementation" - Returns the qiToken's current implementation
          * E.g. "QiToken qiDAI Implementation"
      `,
      "Implementation",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => getImplementation(world, qiToken),
      { namePos: 1 }
    )
  ];
}

export async function getQiTokenValue(world: World, event: Event): Promise<Value> {
  return await getFetcherValue<any, any>("qiToken", qiTokenFetchers(), world, event);
}
