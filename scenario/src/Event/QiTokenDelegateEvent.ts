import { Event } from '../Event';
import { addAction, describeUser, World } from '../World';
import { decodeCall, getPastEvents } from '../Contract';
import { QiToken, QiTokenScenario } from '../Contract/QiToken';
import { QiErc20Delegate } from '../Contract/QiErc20Delegate'
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
import { Arg, Command, View, processCommandEvent } from '../Command';
import { getQiTokenDelegateData } from '../ContractLookup';
import { buildQiTokenDelegate } from '../Builder/QiTokenDelegateBuilder';
import { verify } from '../Verify';

async function genQiTokenDelegate(world: World, from: string, event: Event): Promise<World> {
  let { world: nextWorld, qiTokenDelegate, delegateData } = await buildQiTokenDelegate(world, from, event);
  world = nextWorld;

  world = addAction(
    world,
    `Added qiToken ${delegateData.name} (${delegateData.contract}) at address ${qiTokenDelegate._address}`,
    delegateData.invokation
  );

  return world;
}

async function verifyQiTokenDelegate(world: World, qiTokenDelegate: QiErc20Delegate, name: string, contract: string, apiKey: string): Promise<World> {
  if (world.isLocalNetwork()) {
    world.printer.printLine(`Politely declining to verify on local network: ${world.network}.`);
  } else {
    await verify(world, apiKey, name, contract, qiTokenDelegate._address);
  }

  return world;
}

export function qiTokenDelegateCommands() {
  return [
    new Command<{ qiTokenDelegateParams: EventV }>(`
        #### Deploy

        * "QiTokenDelegate Deploy ...qiTokenDelegateParams" - Generates a new QiTokenDelegate
          * E.g. "QiTokenDelegate Deploy QiDaiDelegate qiDAIDelegate"
      `,
      "Deploy",
      [new Arg("qiTokenDelegateParams", getEventV, { variadic: true })],
      (world, from, { qiTokenDelegateParams }) => genQiTokenDelegate(world, from, qiTokenDelegateParams.val)
    ),
    new View<{ qiTokenDelegateArg: StringV, apiKey: StringV }>(`
        #### Verify

        * "QiTokenDelegate <qiTokenDelegate> Verify apiKey:<String>" - Verifies QiTokenDelegate in Avaxscan
          * E.g. "QiTokenDelegate qiDaiDelegate Verify "myApiKey"
      `,
      "Verify",
      [
        new Arg("qiTokenDelegateArg", getStringV),
        new Arg("apiKey", getStringV)
      ],
      async (world, { qiTokenDelegateArg, apiKey }) => {
        let [qiToken, name, data] = await getQiTokenDelegateData(world, qiTokenDelegateArg.val);

        return await verifyQiTokenDelegate(world, qiToken, name, data.get('contract')!, apiKey.val);
      },
      { namePos: 1 }
    ),
  ];
}

export async function processQiTokenDelegateEvent(world: World, event: Event, from: string | null): Promise<World> {
  return await processCommandEvent<any>("QiTokenDelegate", qiTokenDelegateCommands(), world, event, from);
}
