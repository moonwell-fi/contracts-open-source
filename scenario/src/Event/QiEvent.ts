import { Event } from '../Event';
import { addAction, World, describeUser } from '../World';
import { Benqi, QiScenario } from '../Contract/Qi';
import { buildQi } from '../Builder/QiBuilder';
import { invoke } from '../Invokation';
import {
  getAddressV,
  getEventV,
  getNumberV,
  getStringV,
} from '../CoreValue';
import {
  AddressV,
  EventV,
  NumberV,
  StringV
} from '../Value';
import { Arg, Command, processCommandEvent, View } from '../Command';
import { getComp } from '../ContractLookup';
import { NoErrorReporter } from '../ErrorReporter';
import { verify } from '../Verify';
import { encodedNumber } from '../Encoding';

async function genComp(world: World, from: string, params: Event): Promise<World> {
  let { world: nextWorld, benqi, tokenData } = await buildQi(world, from, params);
  world = nextWorld;

  world = addAction(
    world,
    `Deployed Benqi (${benqi.name}) to address ${benqi._address}`,
    tokenData.invokation
  );

  return world;
}

async function verifyComp(world: World, benqi: Benqi, apiKey: string, modelName: string, contractName: string): Promise<World> {
  if (world.isLocalNetwork()) {
    world.printer.printLine(`Politely declining to verify on local network: ${world.network}.`);
  } else {
    await verify(world, apiKey, modelName, contractName, benqi._address);
  }

  return world;
}

async function approve(world: World, from: string, benqi: Benqi, address: string, amount: NumberV): Promise<World> {
  let invokation = await invoke(world, benqi.methods.approve(address, amount.encode()), from, NoErrorReporter);

  world = addAction(
    world,
    `Approved Benqi token for ${from} of ${amount.show()}`,
    invokation
  );

  return world;
}

async function transfer(world: World, from: string, benqi: Benqi, address: string, amount: NumberV): Promise<World> {
  let invokation = await invoke(world, benqi.methods.transfer(address, amount.encode()), from, NoErrorReporter);

  world = addAction(
    world,
    `Transferred ${amount.show()} Benqi tokens from ${from} to ${address}`,
    invokation
  );

  return world;
}

async function transferFrom(world: World, from: string, benqi: Benqi, owner: string, spender: string, amount: NumberV): Promise<World> {
  let invokation = await invoke(world, benqi.methods.transferFrom(owner, spender, amount.encode()), from, NoErrorReporter);

  world = addAction(
    world,
    `"Transferred from" ${amount.show()} Benqi tokens from ${owner} to ${spender}`,
    invokation
  );

  return world;
}

async function transferScenario(world: World, from: string, benqi: QiScenario, addresses: string[], amount: NumberV): Promise<World> {
  let invokation = await invoke(world, benqi.methods.transferScenario(addresses, amount.encode()), from, NoErrorReporter);

  world = addAction(
    world,
    `Transferred ${amount.show()} Benqi tokens from ${from} to ${addresses}`,
    invokation
  );

  return world;
}

async function transferFromScenario(world: World, from: string, benqi: QiScenario, addresses: string[], amount: NumberV): Promise<World> {
  let invokation = await invoke(world, benqi.methods.transferFromScenario(addresses, amount.encode()), from, NoErrorReporter);

  world = addAction(
    world,
    `Transferred ${amount.show()} Benqi tokens from ${addresses} to ${from}`,
    invokation
  );

  return world;
}

async function delegate(world: World, from: string, benqi: Benqi, account: string): Promise<World> {
  let invokation = await invoke(world, benqi.methods.delegate(account), from, NoErrorReporter);

  world = addAction(
    world,
    `"Delegated from" ${from} to ${account}`,
    invokation
  );

  return world;
}

async function setBlockNumber(
  world: World,
  from: string,
  benqi: Benqi,
  blockNumber: NumberV
): Promise<World> {
  return addAction(
    world,
    `Set Benqi blockNumber to ${blockNumber.show()}`,
    await invoke(world, benqi.methods.setBlockNumber(blockNumber.encode()), from)
  );
}

export function qiCommands() {
  return [
    new Command<{ params: EventV }>(`
        #### Deploy

        * "Deploy ...params" - Generates a new Benqi token
          * E.g. "Benqi Deploy"
      `,
      "Deploy",
      [
        new Arg("params", getEventV, { variadic: true })
      ],
      (world, from, { params }) => genComp(world, from, params.val)
    ),

    new View<{ benqi: Benqi, apiKey: StringV, contractName: StringV }>(`
        #### Verify

        * "<Benqi> Verify apiKey:<String> contractName:<String>=Benqi" - Verifies Benqi token in Avaxscan
          * E.g. "Benqi Verify "myApiKey"
      `,
      "Verify",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("apiKey", getStringV),
        new Arg("contractName", getStringV, { default: new StringV("Benqi") })
      ],
      async (world, { benqi, apiKey, contractName }) => {
        return await verifyComp(world, benqi, apiKey.val, benqi.name, contractName.val)
      }
    ),

    new Command<{ benqi: Benqi, spender: AddressV, amount: NumberV }>(`
        #### Approve

        * "Benqi Approve spender:<Address> <Amount>" - Adds an allowance between user and address
          * E.g. "Benqi Approve Geoff 1.0e18"
      `,
      "Approve",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("spender", getAddressV),
        new Arg("amount", getNumberV)
      ],
      (world, from, { benqi, spender, amount }) => {
        return approve(world, from, benqi, spender.val, amount)
      }
    ),

    new Command<{ benqi: Benqi, recipient: AddressV, amount: NumberV }>(`
        #### Transfer

        * "Benqi Transfer recipient:<User> <Amount>" - Transfers a number of tokens via "transfer" as given user to recipient (this does not depend on allowance)
          * E.g. "Benqi Transfer Torrey 1.0e18"
      `,
      "Transfer",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("recipient", getAddressV),
        new Arg("amount", getNumberV)
      ],
      (world, from, { benqi, recipient, amount }) => transfer(world, from, benqi, recipient.val, amount)
    ),

    new Command<{ benqi: Benqi, owner: AddressV, spender: AddressV, amount: NumberV }>(`
        #### TransferFrom

        * "Benqi TransferFrom owner:<User> spender:<User> <Amount>" - Transfers a number of tokens via "transfeFrom" to recipient (this depends on allowances)
          * E.g. "Benqi TransferFrom Geoff Torrey 1.0e18"
      `,
      "TransferFrom",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("owner", getAddressV),
        new Arg("spender", getAddressV),
        new Arg("amount", getNumberV)
      ],
      (world, from, { benqi, owner, spender, amount }) => transferFrom(world, from, benqi, owner.val, spender.val, amount)
    ),

    new Command<{ benqi: QiScenario, recipients: AddressV[], amount: NumberV }>(`
        #### TransferScenario

        * "Benqi TransferScenario recipients:<User[]> <Amount>" - Transfers a number of tokens via "transfer" to the given recipients (this does not depend on allowance)
          * E.g. "Benqi TransferScenario (Jared Torrey) 10"
      `,
      "TransferScenario",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("recipients", getAddressV, { mapped: true }),
        new Arg("amount", getNumberV)
      ],
      (world, from, { benqi, recipients, amount }) => transferScenario(world, from, benqi, recipients.map(recipient => recipient.val), amount)
    ),

    new Command<{ benqi: QiScenario, froms: AddressV[], amount: NumberV }>(`
        #### TransferFromScenario

        * "Benqi TransferFromScenario froms:<User[]> <Amount>" - Transfers a number of tokens via "transferFrom" from the given users to msg.sender (this depends on allowance)
          * E.g. "Benqi TransferFromScenario (Jared Torrey) 10"
      `,
      "TransferFromScenario",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("froms", getAddressV, { mapped: true }),
        new Arg("amount", getNumberV)
      ],
      (world, from, { benqi, froms, amount }) => transferFromScenario(world, from, benqi, froms.map(_from => _from.val), amount)
    ),

    new Command<{ benqi: Benqi, account: AddressV }>(`
        #### Delegate

        * "Benqi Delegate account:<Address>" - Delegates votes to a given account
          * E.g. "Benqi Delegate Torrey"
      `,
      "Delegate",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("account", getAddressV),
      ],
      (world, from, { benqi, account }) => delegate(world, from, benqi, account.val)
    ),
    new Command<{ benqi: Benqi, blockNumber: NumberV }>(`
      #### SetBlockNumber

      * "SetBlockNumber <Seconds>" - Sets the blockTimestamp of the Benqi Harness
      * E.g. "Benqi SetBlockNumber 500"
      `,
        'SetBlockNumber',
        [new Arg('benqi', getComp, { implicit: true }), new Arg('blockNumber', getNumberV)],
        (world, from, { benqi, blockNumber }) => setBlockNumber(world, from, benqi, blockNumber)
      )
  ];
}

export async function processQiEvent(world: World, event: Event, from: string | null): Promise<World> {
  return await processCommandEvent<any>("Benqi", qiCommands(), world, event, from);
}
