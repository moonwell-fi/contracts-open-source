import { Event } from '../Event';
import { World } from '../World';
import { QiErc20Delegate, QiErc20DelegateScenario } from '../Contract/QiErc20Delegate';
import { QiToken } from '../Contract/QiToken';
import { Invokation } from '../Invokation';
import { getStringV } from '../CoreValue';
import { AddressV, NumberV, StringV } from '../Value';
import { Arg, Fetcher, getFetcherValue } from '../Command';
import { storeAndSaveContract } from '../Networks';
import { getContract, getTestContract } from '../Contract';

const QiDaiDelegateContract = getContract('QiDaiDelegate');
const QiDaiDelegateScenarioContract = getTestContract('QiDaiDelegateScenario');
const QiErc20DelegateContract = getContract('QiErc20Delegate');
const QiErc20DelegateScenarioContract = getTestContract('QiErc20DelegateScenario');


export interface QiTokenDelegateData {
  invokation: Invokation<QiErc20Delegate>;
  name: string;
  contract: string;
  description?: string;
}

export async function buildQiTokenDelegate(
  world: World,
  from: string,
  params: Event
): Promise<{ world: World; qiTokenDelegate: QiErc20Delegate; delegateData: QiTokenDelegateData }> {
  const fetchers = [
    new Fetcher<{ name: StringV; }, QiTokenDelegateData>(
      `
        #### QiDaiDelegate

        * "QiDaiDelegate name:<String>"
          * E.g. "QiTokenDelegate Deploy QiDaiDelegate qiDAIDelegate"
      `,
      'QiDaiDelegate',
      [
        new Arg('name', getStringV)
      ],
      async (
        world,
        { name }
      ) => {
        return {
          invokation: await QiDaiDelegateContract.deploy<QiErc20Delegate>(world, from, []),
          name: name.val,
          contract: 'QiDaiDelegate',
          description: 'Standard QiDai Delegate'
        };
      }
    ),

    new Fetcher<{ name: StringV; }, QiTokenDelegateData>(
      `
        #### QiDaiDelegateScenario

        * "QiDaiDelegateScenario name:<String>" - A QiDaiDelegate Scenario for local testing
          * E.g. "QiTokenDelegate Deploy QiDaiDelegateScenario qiDAIDelegate"
      `,
      'QiDaiDelegateScenario',
      [
        new Arg('name', getStringV)
      ],
      async (
        world,
        { name }
      ) => {
        return {
          invokation: await QiDaiDelegateScenarioContract.deploy<QiErc20DelegateScenario>(world, from, []),
          name: name.val,
          contract: 'QiDaiDelegateScenario',
          description: 'Scenario QiDai Delegate'
        };
      }
    ),

    new Fetcher<{ name: StringV; }, QiTokenDelegateData>(
      `
        #### QiErc20Delegate

        * "QiErc20Delegate name:<String>"
          * E.g. "QiTokenDelegate Deploy QiErc20Delegate qiDAIDelegate"
      `,
      'QiErc20Delegate',
      [
        new Arg('name', getStringV)
      ],
      async (
        world,
        { name }
      ) => {
        return {
          invokation: await QiErc20DelegateContract.deploy<QiErc20Delegate>(world, from, []),
          name: name.val,
          contract: 'QiErc20Delegate',
          description: 'Standard QiErc20 Delegate'
        };
      }
    ),

    new Fetcher<{ name: StringV; }, QiTokenDelegateData>(
      `
        #### QiErc20DelegateScenario

        * "QiErc20DelegateScenario name:<String>" - A QiErc20Delegate Scenario for local testing
          * E.g. "QiTokenDelegate Deploy QiErc20DelegateScenario qiDAIDelegate"
      `,
      'QiErc20DelegateScenario',
      [
        new Arg('name', getStringV),
      ],
      async (
        world,
        { name }
      ) => {
        return {
          invokation: await QiErc20DelegateScenarioContract.deploy<QiErc20DelegateScenario>(world, from, []),
          name: name.val,
          contract: 'QiErc20DelegateScenario',
          description: 'Scenario QiErc20 Delegate'
        };
      }
    )
  ];

  let delegateData = await getFetcherValue<any, QiTokenDelegateData>("DeployQiToken", fetchers, world, params);
  let invokation = delegateData.invokation;
  delete delegateData.invokation;

  if (invokation.error) {
    throw invokation.error;
  }

  const qiTokenDelegate = invokation.value!;

  world = await storeAndSaveContract(
    world,
    qiTokenDelegate,
    delegateData.name,
    invokation,
    [
      {
        index: ['QiTokenDelegate', delegateData.name],
        data: {
          address: qiTokenDelegate._address,
          contract: delegateData.contract,
          description: delegateData.description
        }
      }
    ]
  );

  return { world, qiTokenDelegate, delegateData };
}
