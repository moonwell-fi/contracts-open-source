import { Event } from '../Event';
import { World, addAction } from '../World';
import { Benqi, QiScenario } from '../Contract/Qi';
import { Invokation } from '../Invokation';
import { getAddressV } from '../CoreValue';
import { StringV, AddressV } from '../Value';
import { Arg, Fetcher, getFetcherValue } from '../Command';
import { storeAndSaveContract } from '../Networks';
import { getContract } from '../Contract';

const QiContract = getContract('Benqi');
const QiScenarioContract = getContract('QiScenario');

export interface TokenData {
  invokation: Invokation<Benqi>;
  contract: string;
  address?: string;
  symbol: string;
  name: string;
  decimals?: number;
}

export async function buildQi(
  world: World,
  from: string,
  params: Event
): Promise<{ world: World; benqi: Benqi; tokenData: TokenData }> {
  const fetchers = [
    new Fetcher<{ account: AddressV }, TokenData>(
      `
      #### Scenario

      * "Benqi Deploy Scenario account:<Address>" - Deploys Scenario Benqi Token
        * E.g. "Benqi Deploy Scenario Geoff"
    `,
      'Scenario',
      [
        new Arg("account", getAddressV),
      ],
      async (world, { account }) => {
        return {
          invokation: await QiScenarioContract.deploy<QiScenario>(world, from, [account.val]),
          contract: 'QiScenario',
          symbol: 'BENQI',
          name: 'Benqi Governance Token',
          decimals: 18
        };
      }
    ),

    new Fetcher<{ account: AddressV }, TokenData>(
      `
      #### Benqi

      * "Benqi Deploy account:<Address>" - Deploys Benqi Token
        * E.g. "Benqi Deploy Geoff"
    `,
      'Benqi',
      [
        new Arg("account", getAddressV),
      ],
      async (world, { account }) => {
        if (world.isLocalNetwork()) {
          return {
            invokation: await QiScenarioContract.deploy<QiScenario>(world, from, [account.val]),
            contract: 'QiScenario',
            symbol: 'BENQI',
            name: 'Benqi Governance Token',
            decimals: 18
          };
        } else {
          return {
            invokation: await QiContract.deploy<Benqi>(world, from, [account.val]),
            contract: 'Benqi',
            symbol: 'BENQI',
            name: 'Benqi Governance Token',
            decimals: 18
          };
        }
      },
      { catchall: true }
    )
  ];

  let tokenData = await getFetcherValue<any, TokenData>("DeployComp", fetchers, world, params);
  let invokation = tokenData.invokation;
  delete tokenData.invokation;

  if (invokation.error) {
    throw invokation.error;
  }

  const benqi = invokation.value!;
  tokenData.address = benqi._address;

  world = await storeAndSaveContract(
    world,
    benqi,
    'Benqi',
    invokation,
    [
      { index: ['Benqi'], data: tokenData },
      { index: ['Tokens', tokenData.symbol], data: tokenData }
    ]
  );

  tokenData.invokation = invokation;

  return { world, benqi, tokenData };
}
