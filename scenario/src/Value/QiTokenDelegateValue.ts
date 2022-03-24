import { Event } from '../Event';
import { World } from '../World';
import { QiErc20Delegate } from '../Contract/QiErc20Delegate';
import {
  getCoreValue,
  mapValue
} from '../CoreValue';
import { Arg, Fetcher, getFetcherValue } from '../Command';
import {
  AddressV,
  Value,
} from '../Value';
import { getWorldContractByAddress, getQiTokenDelegateAddress } from '../ContractLookup';

export async function getQiTokenDelegateV(world: World, event: Event): Promise<QiErc20Delegate> {
  const address = await mapValue<AddressV>(
    world,
    event,
    (str) => new AddressV(getQiTokenDelegateAddress(world, str)),
    getCoreValue,
    AddressV
  );

  return getWorldContractByAddress<QiErc20Delegate>(world, address.val);
}

async function qiTokenDelegateAddress(world: World, qiTokenDelegate: QiErc20Delegate): Promise<AddressV> {
  return new AddressV(qiTokenDelegate._address);
}

export function qiTokenDelegateFetchers() {
  return [
    new Fetcher<{ qiTokenDelegate: QiErc20Delegate }, AddressV>(`
        #### Address

        * "QiTokenDelegate <QiTokenDelegate> Address" - Returns address of QiTokenDelegate contract
          * E.g. "QiTokenDelegate qiDaiDelegate Address" - Returns qiDaiDelegate's address
      `,
      "Address",
      [
        new Arg("qiTokenDelegate", getQiTokenDelegateV)
      ],
      (world, { qiTokenDelegate }) => qiTokenDelegateAddress(world, qiTokenDelegate),
      { namePos: 1 }
    ),
  ];
}

export async function getQiTokenDelegateValue(world: World, event: Event): Promise<Value> {
  return await getFetcherValue<any, any>("QiTokenDelegate", qiTokenDelegateFetchers(), world, event);
}
