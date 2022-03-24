import { Event } from '../Event';
import { addAction, describeUser, World } from '../World';
import { decodeCall, getPastEvents } from '../Contract';
import { QiToken, QiTokenScenario } from '../Contract/QiToken';
import { QiErc20Delegate } from '../Contract/QiErc20Delegate'
import { QiErc20Delegator } from '../Contract/QiErc20Delegator'
import { invoke, Sendable } from '../Invokation';
import {
  getAddressV,
  getEventV,
  getExpNumberV,
  getNumberV,
  getStringV,
  getBoolV
} from '../CoreValue';
import {
  AddressV,
  BoolV,
  EventV,
  NothingV,
  NumberV,
  StringV
} from '../Value';
import { getContract } from '../Contract';
import { Arg, Command, View, processCommandEvent } from '../Command';
import { QiTokenErrorReporter } from '../ErrorReporter';
import { getComptroller, getQiTokenData } from '../ContractLookup';
import { getExpMantissa } from '../Encoding';
import { buildQiToken } from '../Builder/QiTokenBuilder';
import { verify } from '../Verify';
import { getLiquidity } from '../Value/ComptrollerValue';
import { encodedNumber } from '../Encoding';
import { getQiTokenV, getQiErc20DelegatorV } from '../Value/QiTokenValue';

function showTrxValue(world: World): string {
  return new NumberV(world.trxInvokationOpts.get('value')).show();
}

async function genQiToken(world: World, from: string, event: Event): Promise<World> {
  let { world: nextWorld, qiToken, tokenData } = await buildQiToken(world, from, event);
  world = nextWorld;

  world = addAction(
    world,
    `Added qiToken ${tokenData.name} (${tokenData.contract}<decimals=${tokenData.decimals}>) at address ${qiToken._address}`,
    tokenData.invokation
  );

  return world;
}

async function accrueInterest(world: World, from: string, qiToken: QiToken): Promise<World> {
  let invokation = await invoke(world, qiToken.methods.accrueInterest(), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: Interest accrued`,
    invokation
  );

  return world;
}

async function mint(world: World, from: string, qiToken: QiToken, amount: NumberV | NothingV): Promise<World> {
  let invokation;
  let showAmount;

  if (amount instanceof NumberV) {
    showAmount = amount.show();
    invokation = await invoke(world, qiToken.methods.mint(amount.encode()), from, QiTokenErrorReporter);
  } else {
    showAmount = showTrxValue(world);
    invokation = await invoke(world, qiToken.methods.mint(), from, QiTokenErrorReporter);
  }

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} mints ${showAmount}`,
    invokation
  );

  return world;
}

async function redeem(world: World, from: string, qiToken: QiToken, tokens: NumberV): Promise<World> {
  let invokation = await invoke(world, qiToken.methods.redeem(tokens.encode()), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} redeems ${tokens.show()} tokens`,
    invokation
  );

  return world;
}

async function redeemUnderlying(world: World, from: string, qiToken: QiToken, amount: NumberV): Promise<World> {
  let invokation = await invoke(world, qiToken.methods.redeemUnderlying(amount.encode()), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} redeems ${amount.show()} underlying`,
    invokation
  );

  return world;
}

async function borrow(world: World, from: string, qiToken: QiToken, amount: NumberV): Promise<World> {
  let invokation = await invoke(world, qiToken.methods.borrow(amount.encode()), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} borrows ${amount.show()}`,
    invokation
  );

  return world;
}

async function repayBorrow(world: World, from: string, qiToken: QiToken, amount: NumberV | NothingV): Promise<World> {
  let invokation;
  let showAmount;

  if (amount instanceof NumberV) {
    showAmount = amount.show();
    invokation = await invoke(world, qiToken.methods.repayBorrow(amount.encode()), from, QiTokenErrorReporter);
  } else {
    showAmount = showTrxValue(world);
    invokation = await invoke(world, qiToken.methods.repayBorrow(), from, QiTokenErrorReporter);
  }

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} repays ${showAmount} of borrow`,
    invokation
  );

  return world;
}

async function repayBorrowBehalf(world: World, from: string, behalf: string, qiToken: QiToken, amount: NumberV | NothingV): Promise<World> {
  let invokation;
  let showAmount;

  if (amount instanceof NumberV) {
    showAmount = amount.show();
    invokation = await invoke(world, qiToken.methods.repayBorrowBehalf(behalf, amount.encode()), from, QiTokenErrorReporter);
  } else {
    showAmount = showTrxValue(world);
    invokation = await invoke(world, qiToken.methods.repayBorrowBehalf(behalf), from, QiTokenErrorReporter);
  }

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} repays ${showAmount} of borrow on behalf of ${describeUser(world, behalf)}`,
    invokation
  );

  return world;
}

async function liquidateBorrow(world: World, from: string, qiToken: QiToken, borrower: string, collateral: QiToken, repayAmount: NumberV | NothingV): Promise<World> {
  let invokation;
  let showAmount;

  if (repayAmount instanceof NumberV) {
    showAmount = repayAmount.show();
    invokation = await invoke(world, qiToken.methods.liquidateBorrow(borrower, repayAmount.encode(), collateral._address), from, QiTokenErrorReporter);
  } else {
    showAmount = showTrxValue(world);
    invokation = await invoke(world, qiToken.methods.liquidateBorrow(borrower, collateral._address), from, QiTokenErrorReporter);
  }

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} liquidates ${showAmount} from of ${describeUser(world, borrower)}, seizing ${collateral.name}.`,
    invokation
  );

  return world;
}

async function seize(world: World, from: string, qiToken: QiToken, liquidator: string, borrower: string, seizeTokens: NumberV): Promise<World> {
  let invokation = await invoke(world, qiToken.methods.seize(liquidator, borrower, seizeTokens.encode()), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} initiates seizing ${seizeTokens.show()} to ${describeUser(world, liquidator)} from ${describeUser(world, borrower)}.`,
    invokation
  );

  return world;
}

async function evilSeize(world: World, from: string, qiToken: QiToken, treasure: QiToken, liquidator: string, borrower: string, seizeTokens: NumberV): Promise<World> {
  let invokation = await invoke(world, qiToken.methods.evilSeize(treasure._address, liquidator, borrower, seizeTokens.encode()), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} initiates illegal seizing ${seizeTokens.show()} to ${describeUser(world, liquidator)} from ${describeUser(world, borrower)}.`,
    invokation
  );

  return world;
}

async function setPendingAdmin(world: World, from: string, qiToken: QiToken, newPendingAdmin: string): Promise<World> {
  let invokation = await invoke(world, qiToken.methods._setPendingAdmin(newPendingAdmin), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} sets pending admin to ${newPendingAdmin}`,
    invokation
  );

  return world;
}

async function acceptAdmin(world: World, from: string, qiToken: QiToken): Promise<World> {
  let invokation = await invoke(world, qiToken.methods._acceptAdmin(), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} accepts admin`,
    invokation
  );

  return world;
}

async function addReserves(world: World, from: string, qiToken: QiToken, amount: NumberV): Promise<World> {
  let invokation = await invoke(world, qiToken.methods._addReserves(amount.encode()), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} adds to reserves by ${amount.show()}`,
    invokation
  );

  return world;
}

async function reduceReserves(world: World, from: string, qiToken: QiToken, amount: NumberV): Promise<World> {
  let invokation = await invoke(world, qiToken.methods._reduceReserves(amount.encode()), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} reduces reserves by ${amount.show()}`,
    invokation
  );

  return world;
}

async function setReserveFactor(world: World, from: string, qiToken: QiToken, reserveFactor: NumberV): Promise<World> {
  let invokation = await invoke(world, qiToken.methods._setReserveFactor(reserveFactor.encode()), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(world, from)} sets reserve factor to ${reserveFactor.show()}`,
    invokation
  );

  return world;
}

async function setInterestRateModel(world: World, from: string, qiToken: QiToken, interestRateModel: string): Promise<World> {
  let invokation = await invoke(world, qiToken.methods._setInterestRateModel(interestRateModel), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `Set interest rate for ${qiToken.name} to ${interestRateModel} as ${describeUser(world, from)}`,
    invokation
  );

  return world;
}

async function setComptroller(world: World, from: string, qiToken: QiToken, comptroller: string): Promise<World> {
  let invokation = await invoke(world, qiToken.methods._setComptroller(comptroller), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `Set comptroller for ${qiToken.name} to ${comptroller} as ${describeUser(world, from)}`,
    invokation
  );

  return world;
}

async function sweepToken(world: World, from: string, qiToken: QiToken, token: string): Promise<World> {
  let invokation = await invoke(world, qiToken.methods.sweepToken(token), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `Swept ERC-20 at ${token} to admin`,
    invokation
  );

  return world;
}

async function becomeImplementation(
  world: World,
  from: string,
  qiToken: QiToken,
  becomeImplementationData: string
): Promise<World> {

  const qiErc20Delegate = getContract('QiErc20Delegate');
  const qiErc20DelegateContract = await qiErc20Delegate.at<QiErc20Delegate>(world, qiToken._address);

  let invokation = await invoke(
    world,
    qiErc20DelegateContract.methods._becomeImplementation(becomeImplementationData),
    from,
    QiTokenErrorReporter
  );

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(
      world,
      from
    )} initiates _becomeImplementation with data:${becomeImplementationData}.`,
    invokation
  );

  return world;
}

async function resignImplementation(
  world: World,
  from: string,
  qiToken: QiToken,
): Promise<World> {

  const qiErc20Delegate = getContract('QiErc20Delegate');
  const qiErc20DelegateContract = await qiErc20Delegate.at<QiErc20Delegate>(world, qiToken._address);

  let invokation = await invoke(
    world,
    qiErc20DelegateContract.methods._resignImplementation(),
    from,
    QiTokenErrorReporter
  );

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(
      world,
      from
    )} initiates _resignImplementation.`,
    invokation
  );

  return world;
}

async function setImplementation(
  world: World,
  from: string,
  qiToken: QiErc20Delegator,
  implementation: string,
  allowResign: boolean,
  becomeImplementationData: string
): Promise<World> {
  let invokation = await invoke(
    world,
    qiToken.methods._setImplementation(
      implementation,
      allowResign,
      becomeImplementationData
    ),
    from,
    QiTokenErrorReporter
  );

  world = addAction(
    world,
    `QiToken ${qiToken.name}: ${describeUser(
      world,
      from
    )} initiates setImplementation with implementation:${implementation} allowResign:${allowResign} data:${becomeImplementationData}.`,
    invokation
  );

  return world;
}

async function donate(world: World, from: string, qiToken: QiToken): Promise<World> {
  let invokation = await invoke(world, qiToken.methods.donate(), from, QiTokenErrorReporter);

  world = addAction(
    world,
    `Donate for ${qiToken.name} as ${describeUser(world, from)} with value ${showTrxValue(world)}`,
    invokation
  );

  return world;
}

async function setQiTokenMock(world: World, from: string, qiToken: QiTokenScenario, mock: string, value: NumberV): Promise<World> {
  let mockMethod: (number) => Sendable<void>;

  switch (mock.toLowerCase()) {
    case "totalborrows":
      mockMethod = qiToken.methods.setTotalBorrows;
      break;
    case "totalreserves":
      mockMethod = qiToken.methods.setTotalReserves;
      break;
    default:
      throw new Error(`Mock "${mock}" not defined for qiToken`);
  }

  let invokation = await invoke(world, mockMethod(value.encode()), from);

  world = addAction(
    world,
    `Mocked ${mock}=${value.show()} for ${qiToken.name}`,
    invokation
  );

  return world;
}

async function verifyQiToken(world: World, qiToken: QiToken, name: string, contract: string, apiKey: string): Promise<World> {
  if (world.isLocalNetwork()) {
    world.printer.printLine(`Politely declining to verify on local network: ${world.network}.`);
  } else {
    await verify(world, apiKey, name, contract, qiToken._address);
  }

  return world;
}

async function printMinters(world: World, qiToken: QiToken): Promise<World> {
  let events = await getPastEvents(world, qiToken, qiToken.name, 'Mint');
  let addresses = events.map((event) => event.returnValues['minter']);
  let uniq = [...new Set(addresses)];

  world.printer.printLine("Minters:")

  uniq.forEach((address) => {
    world.printer.printLine(`\t${address}`)
  });

  return world;
}

async function printBorrowers(world: World, qiToken: QiToken): Promise<World> {
  let events = await getPastEvents(world, qiToken, qiToken.name, 'Borrow');
  let addresses = events.map((event) => event.returnValues['borrower']);
  let uniq = [...new Set(addresses)];

  world.printer.printLine("Borrowers:")

  uniq.forEach((address) => {
    world.printer.printLine(`\t${address}`)
  });

  return world;
}

async function printLiquidity(world: World, qiToken: QiToken): Promise<World> {
  let mintEvents = await getPastEvents(world, qiToken, qiToken.name, 'Mint');
  let mintAddresses = mintEvents.map((event) => event.returnValues['minter']);
  let borrowEvents = await getPastEvents(world, qiToken, qiToken.name, 'Borrow');
  let borrowAddresses = borrowEvents.map((event) => event.returnValues['borrower']);
  let uniq = [...new Set(mintAddresses.concat(borrowAddresses))];
  let comptroller = await getComptroller(world);

  world.printer.printLine("Liquidity:")

  const liquidityMap = await Promise.all(uniq.map(async (address) => {
    let userLiquidity = await getLiquidity(world, comptroller, address);

    return [address, userLiquidity.val];
  }));

  liquidityMap.forEach(([address, liquidity]) => {
    world.printer.printLine(`\t${world.settings.lookupAlias(address)}: ${liquidity / 1e18}e18`)
  });

  return world;
}

export function qiTokenCommands() {
  return [
    new Command<{ qiTokenParams: EventV }>(`
        #### Deploy

        * "QiToken Deploy ...qiTokenParams" - Generates a new QiToken
          * E.g. "QiToken qiZRX Deploy"
      `,
      "Deploy",
      [new Arg("qiTokenParams", getEventV, { variadic: true })],
      (world, from, { qiTokenParams }) => genQiToken(world, from, qiTokenParams.val)
    ),
    new View<{ qiTokenArg: StringV, apiKey: StringV }>(`
        #### Verify

        * "QiToken <qiToken> Verify apiKey:<String>" - Verifies QiToken in Avaxscan
          * E.g. "QiToken qiZRX Verify "myApiKey"
      `,
      "Verify",
      [
        new Arg("qiTokenArg", getStringV),
        new Arg("apiKey", getStringV)
      ],
      async (world, { qiTokenArg, apiKey }) => {
        let [qiToken, name, data] = await getQiTokenData(world, qiTokenArg.val);

        return await verifyQiToken(world, qiToken, name, data.get('contract')!, apiKey.val);
      },
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken }>(`
        #### AccrueInterest

        * "QiToken <qiToken> AccrueInterest" - Accrues interest for given token
          * E.g. "QiToken qiZRX AccrueInterest"
      `,
      "AccrueInterest",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, from, { qiToken }) => accrueInterest(world, from, qiToken),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, amount: NumberV | NothingV }>(`
        #### Mint

        * "QiToken <qiToken> Mint amount:<Number>" - Mints the given amount of qiToken as specified user
          * E.g. "QiToken qiZRX Mint 1.0e18"
      `,
      "Mint",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("amount", getNumberV, { nullable: true })
      ],
      (world, from, { qiToken, amount }) => mint(world, from, qiToken, amount),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, tokens: NumberV }>(`
        #### Redeem

        * "QiToken <qiToken> Redeem tokens:<Number>" - Redeems the given amount of qiTokens as specified user
          * E.g. "QiToken qiZRX Redeem 1.0e9"
      `,
      "Redeem",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("tokens", getNumberV)
      ],
      (world, from, { qiToken, tokens }) => redeem(world, from, qiToken, tokens),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, amount: NumberV }>(`
        #### RedeemUnderlying

        * "QiToken <qiToken> RedeemUnderlying amount:<Number>" - Redeems the given amount of underlying as specified user
          * E.g. "QiToken qiZRX RedeemUnderlying 1.0e18"
      `,
      "RedeemUnderlying",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("amount", getNumberV)
      ],
      (world, from, { qiToken, amount }) => redeemUnderlying(world, from, qiToken, amount),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, amount: NumberV }>(`
        #### Borrow

        * "QiToken <qiToken> Borrow amount:<Number>" - Borrows the given amount of this qiToken as specified user
          * E.g. "QiToken qiZRX Borrow 1.0e18"
      `,
      "Borrow",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("amount", getNumberV)
      ],
      // Note: we override from
      (world, from, { qiToken, amount }) => borrow(world, from, qiToken, amount),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, amount: NumberV | NothingV }>(`
        #### RepayBorrow

        * "QiToken <qiToken> RepayBorrow underlyingAmount:<Number>" - Repays borrow in the given underlying amount as specified user
          * E.g. "QiToken qiZRX RepayBorrow 1.0e18"
      `,
      "RepayBorrow",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("amount", getNumberV, { nullable: true })
      ],
      (world, from, { qiToken, amount }) => repayBorrow(world, from, qiToken, amount),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, behalf: AddressV, amount: NumberV | NothingV }>(`
        #### RepayBorrowBehalf

        * "QiToken <qiToken> RepayBorrowBehalf behalf:<User> underlyingAmount:<Number>" - Repays borrow in the given underlying amount on behalf of another user
          * E.g. "QiToken qiZRX RepayBorrowBehalf Geoff 1.0e18"
      `,
      "RepayBorrowBehalf",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("behalf", getAddressV),
        new Arg("amount", getNumberV, { nullable: true })
      ],
      (world, from, { qiToken, behalf, amount }) => repayBorrowBehalf(world, from, behalf.val, qiToken, amount),
      { namePos: 1 }
    ),
    new Command<{ borrower: AddressV, qiToken: QiToken, collateral: QiToken, repayAmount: NumberV | NothingV }>(`
        #### Liquidate

        * "QiToken <qiToken> Liquidate borrower:<User> qiTokenCollateral:<Address> repayAmount:<Number>" - Liquidates repayAmount of given token seizing collateral token
          * E.g. "QiToken qiZRX Liquidate Geoff qiBAT 1.0e18"
      `,
      "Liquidate",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("borrower", getAddressV),
        new Arg("collateral", getQiTokenV),
        new Arg("repayAmount", getNumberV, { nullable: true })
      ],
      (world, from, { borrower, qiToken, collateral, repayAmount }) => liquidateBorrow(world, from, qiToken, borrower.val, collateral, repayAmount),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, liquidator: AddressV, borrower: AddressV, seizeTokens: NumberV }>(`
        #### Seize

        * "QiToken <qiToken> Seize liquidator:<User> borrower:<User> seizeTokens:<Number>" - Seizes a given number of tokens from a user (to be called from other QiToken)
          * E.g. "QiToken qiZRX Seize Geoff Torrey 1.0e18"
      `,
      "Seize",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("liquidator", getAddressV),
        new Arg("borrower", getAddressV),
        new Arg("seizeTokens", getNumberV)
      ],
      (world, from, { qiToken, liquidator, borrower, seizeTokens }) => seize(world, from, qiToken, liquidator.val, borrower.val, seizeTokens),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, treasure: QiToken, liquidator: AddressV, borrower: AddressV, seizeTokens: NumberV }>(`
        #### EvilSeize

        * "QiToken <qiToken> EvilSeize treasure:<Token> liquidator:<User> borrower:<User> seizeTokens:<Number>" - Improperly seizes a given number of tokens from a user
          * E.g. "QiToken qiEVL EvilSeize qiZRX Geoff Torrey 1.0e18"
      `,
      "EvilSeize",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("treasure", getQiTokenV),
        new Arg("liquidator", getAddressV),
        new Arg("borrower", getAddressV),
        new Arg("seizeTokens", getNumberV)
      ],
      (world, from, { qiToken, treasure, liquidator, borrower, seizeTokens }) => evilSeize(world, from, qiToken, treasure, liquidator.val, borrower.val, seizeTokens),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, amount: NumberV }>(`
        #### ReduceReserves

        * "QiToken <qiToken> ReduceReserves amount:<Number>" - Reduces the reserves of the qiToken
          * E.g. "QiToken qiZRX ReduceReserves 1.0e18"
      `,
      "ReduceReserves",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("amount", getNumberV)
      ],
      (world, from, { qiToken, amount }) => reduceReserves(world, from, qiToken, amount),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, amount: NumberV }>(`
    #### AddReserves

    * "QiToken <qiToken> AddReserves amount:<Number>" - Adds reserves to the qiToken
      * E.g. "QiToken qiZRX AddReserves 1.0e18"
  `,
      "AddReserves",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("amount", getNumberV)
      ],
      (world, from, { qiToken, amount }) => addReserves(world, from, qiToken, amount),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, newPendingAdmin: AddressV }>(`
        #### SetPendingAdmin

        * "QiToken <qiToken> SetPendingAdmin newPendingAdmin:<Address>" - Sets the pending admin for the qiToken
          * E.g. "QiToken qiZRX SetPendingAdmin Geoff"
      `,
      "SetPendingAdmin",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("newPendingAdmin", getAddressV)
      ],
      (world, from, { qiToken, newPendingAdmin }) => setPendingAdmin(world, from, qiToken, newPendingAdmin.val),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken }>(`
        #### AcceptAdmin

        * "QiToken <qiToken> AcceptAdmin" - Accepts admin for the qiToken
          * E.g. "From Geoff (QiToken qiZRX AcceptAdmin)"
      `,
      "AcceptAdmin",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, from, { qiToken }) => acceptAdmin(world, from, qiToken),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, reserveFactor: NumberV }>(`
        #### SetReserveFactor

        * "QiToken <qiToken> SetReserveFactor reserveFactor:<Number>" - Sets the reserve factor for the qiToken
          * E.g. "QiToken qiZRX SetReserveFactor 0.1"
      `,
      "SetReserveFactor",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("reserveFactor", getExpNumberV)
      ],
      (world, from, { qiToken, reserveFactor }) => setReserveFactor(world, from, qiToken, reserveFactor),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, interestRateModel: AddressV }>(`
        #### SetInterestRateModel

        * "QiToken <qiToken> SetInterestRateModel interestRateModel:<Contract>" - Sets the interest rate model for the given qiToken
          * E.g. "QiToken qiZRX SetInterestRateModel (FixedRate 1.5)"
      `,
      "SetInterestRateModel",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("interestRateModel", getAddressV)
      ],
      (world, from, { qiToken, interestRateModel }) => setInterestRateModel(world, from, qiToken, interestRateModel.val),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, token: AddressV }>(`
        #### SweepToken

        * "QiToken <qiToken> SweepToken erc20Token:<Contract>" - Sweeps the given erc-20 token from the contract
          * E.g. "QiToken qiZRX SweepToken BAT"
      `,
      "SweepToken",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("token", getAddressV)
      ],
      (world, from, { qiToken, token }) => sweepToken(world, from, qiToken, token.val),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, comptroller: AddressV }>(`
        #### SetComptroller

        * "QiToken <qiToken> SetComptroller comptroller:<Contract>" - Sets the comptroller for the given qiToken
          * E.g. "QiToken qiZRX SetComptroller Comptroller"
      `,
      "SetComptroller",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("comptroller", getAddressV)
      ],
      (world, from, { qiToken, comptroller }) => setComptroller(world, from, qiToken, comptroller.val),
      { namePos: 1 }
    ),
    new Command<{
      qiToken: QiToken;
      becomeImplementationData: StringV;
    }>(
      `
        #### BecomeImplementation

        * "QiToken <qiToken> BecomeImplementation becomeImplementationData:<String>"
          * E.g. "QiToken qiDAI BecomeImplementation "0x01234anyByTeS56789""
      `,
      'BecomeImplementation',
      [
        new Arg('qiToken', getQiTokenV),
        new Arg('becomeImplementationData', getStringV)
      ],
      (world, from, { qiToken, becomeImplementationData }) =>
        becomeImplementation(
          world,
          from,
          qiToken,
          becomeImplementationData.val
        ),
      { namePos: 1 }
    ),
    new Command<{qiToken: QiToken;}>(
      `
        #### ResignImplementation

        * "QiToken <qiToken> ResignImplementation"
          * E.g. "QiToken qiDAI ResignImplementation"
      `,
      'ResignImplementation',
      [new Arg('qiToken', getQiTokenV)],
      (world, from, { qiToken }) =>
        resignImplementation(
          world,
          from,
          qiToken
        ),
      { namePos: 1 }
    ),
    new Command<{
      qiToken: QiErc20Delegator;
      implementation: AddressV;
      allowResign: BoolV;
      becomeImplementationData: StringV;
    }>(
      `
        #### SetImplementation

        * "QiToken <qiToken> SetImplementation implementation:<Address> allowResign:<Bool> becomeImplementationData:<String>"
          * E.g. "QiToken qiDAI SetImplementation (QiToken qiDAIDelegate Address) True "0x01234anyByTeS56789"
      `,
      'SetImplementation',
      [
        new Arg('qiToken', getQiErc20DelegatorV),
        new Arg('implementation', getAddressV),
        new Arg('allowResign', getBoolV),
        new Arg('becomeImplementationData', getStringV)
      ],
      (world, from, { qiToken, implementation, allowResign, becomeImplementationData }) =>
        setImplementation(
          world,
          from,
          qiToken,
          implementation.val,
          allowResign.val,
          becomeImplementationData.val
        ),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken }>(`
        #### Donate

        * "QiToken <qiToken> Donate" - Calls the donate (payable no-op) function
          * E.g. "(Trx Value 5.0e18 (QiToken qiAVAX Donate))"
      `,
      "Donate",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, from, { qiToken }) => donate(world, from, qiToken),
      { namePos: 1 }
    ),
    new Command<{ qiToken: QiToken, variable: StringV, value: NumberV }>(`
        #### Mock

        * "QiToken <qiToken> Mock variable:<String> value:<Number>" - Mocks a given value on qiToken. Note: value must be a supported mock and this will only work on a "QiTokenScenario" contract.
          * E.g. "QiToken qiZRX Mock totalBorrows 5.0e18"
          * E.g. "QiToken qiZRX Mock totalReserves 0.5e18"
      `,
      "Mock",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("variable", getStringV),
        new Arg("value", getNumberV),
      ],
      (world, from, { qiToken, variable, value }) => setQiTokenMock(world, from, <QiTokenScenario>qiToken, variable.val, value),
      { namePos: 1 }
    ),
    new View<{ qiToken: QiToken }>(`
        #### Minters

        * "QiToken <qiToken> Minters" - Print address of all minters
      `,
      "Minters",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => printMinters(world, qiToken),
      { namePos: 1 }
    ),
    new View<{ qiToken: QiToken }>(`
        #### Borrowers

        * "QiToken <qiToken> Borrowers" - Print address of all borrowers
      `,
      "Borrowers",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => printBorrowers(world, qiToken),
      { namePos: 1 }
    ),
    new View<{ qiToken: QiToken }>(`
        #### Liquidity

        * "QiToken <qiToken> Liquidity" - Prints liquidity of all minters or borrowers
      `,
      "Liquidity",
      [
        new Arg("qiToken", getQiTokenV)
      ],
      (world, { qiToken }) => printLiquidity(world, qiToken),
      { namePos: 1 }
    ),
    new View<{ qiToken: QiToken, input: StringV }>(`
        #### Decode

        * "Decode <qiToken> input:<String>" - Prints information about a call to a qiToken contract
      `,
      "Decode",
      [
        new Arg("qiToken", getQiTokenV),
        new Arg("input", getStringV)

      ],
      (world, { qiToken, input }) => decodeCall(world, qiToken, input.val),
      { namePos: 1 }
    )
  ];
}

export async function processQiTokenEvent(world: World, event: Event, from: string | null): Promise<World> {
  return await processCommandEvent<any>("QiToken", qiTokenCommands(), world, event, from);
}
