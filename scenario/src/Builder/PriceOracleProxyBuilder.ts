import {Event} from '../Event';
import {addAction, World} from '../World';
import {PriceOracleProxy} from '../Contract/PriceOracleProxy';
import {Invokation} from '../Invokation';
import {Arg, Fetcher, getFetcherValue} from '../Command';
import {storeAndSaveContract} from '../Networks';
import {getContract} from '../Contract';
import {getAddressV} from '../CoreValue';
import {AddressV} from '../Value';

const PriceOracleProxyContract = getContract("PriceOracleProxy");

export interface PriceOracleProxyData {
  invokation?: Invokation<PriceOracleProxy>,
  contract?: PriceOracleProxy,
  description: string,
  address?: string,
  qiAVAX: string,
  qiUSDC: string,
  qiDAI: string
}

export async function buildPriceOracleProxy(world: World, from: string, event: Event): Promise<{world: World, priceOracleProxy: PriceOracleProxy, invokation: Invokation<PriceOracleProxy>}> {
  const fetchers = [
    new Fetcher<{guardian: AddressV, priceOracle: AddressV, qiAVAX: AddressV, qiUSDC: AddressV, qiSAI: AddressV, qiDAI: AddressV, qiUSDT: AddressV}, PriceOracleProxyData>(`
        #### Price Oracle Proxy

        * "Deploy <Guardian:Address> <PriceOracle:Address> <qiAVAX:Address> <qiUSDC:Address> <qiSAI:Address> <qiDAI:Address> <qiUSDT:Address>" - The Price Oracle which proxies to a backing oracle
        * E.g. "PriceOracleProxy Deploy Admin (PriceOracle Address) qiAVAX qiUSDC qiSAI qiDAI qiUSDT"
      `,
      "PriceOracleProxy",
      [
        new Arg("guardian", getAddressV),
        new Arg("priceOracle", getAddressV),
        new Arg("qiAVAX", getAddressV),
        new Arg("qiUSDC", getAddressV),
        new Arg("qiSAI", getAddressV),
        new Arg("qiDAI", getAddressV),
        new Arg("qiUSDT", getAddressV)
      ],
      async (world, {guardian, priceOracle, qiAVAX, qiUSDC, qiSAI, qiDAI, qiUSDT}) => {
        return {
          invokation: await PriceOracleProxyContract.deploy<PriceOracleProxy>(world, from, [guardian.val, priceOracle.val, qiAVAX.val, qiUSDC.val, qiSAI.val, qiDAI.val, qiUSDT.val]),
          description: "Price Oracle Proxy",
          qiAVAX: qiAVAX.val,
          qiUSDC: qiUSDC.val,
          qiSAI: qiSAI.val,
          qiDAI: qiDAI.val,
          qiUSDT: qiUSDT.val
        };
      },
      {catchall: true}
    )
  ];

  let priceOracleProxyData = await getFetcherValue<any, PriceOracleProxyData>("DeployPriceOracleProxy", fetchers, world, event);
  let invokation = priceOracleProxyData.invokation!;
  delete priceOracleProxyData.invokation;

  if (invokation.error) {
    throw invokation.error;
  }
  const priceOracleProxy = invokation.value!;
  priceOracleProxyData.address = priceOracleProxy._address;

  world = await storeAndSaveContract(
    world,
    priceOracleProxy,
    'PriceOracleProxy',
    invokation,
    [
      { index: ['PriceOracleProxy'], data: priceOracleProxyData }
    ]
  );

  return {world, priceOracleProxy, invokation};
}
