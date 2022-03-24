import { Event } from '../Event';
import { World } from '../World';
import { Benqi } from '../Contract/Qi';
import {
  getAddressV,
  getNumberV
} from '../CoreValue';
import {
  AddressV,
  ListV,
  NumberV,
  StringV,
  Value
} from '../Value';
import { Arg, Fetcher, getFetcherValue } from '../Command';
import { getComp } from '../ContractLookup';

export function qiFetchers() {
  return [
    new Fetcher<{ benqi: Benqi }, AddressV>(`
        #### Address

        * "<Benqi> Address" - Returns the address of Benqi token
          * E.g. "Benqi Address"
      `,
      "Address",
      [
        new Arg("benqi", getComp, { implicit: true })
      ],
      async (world, { benqi }) => new AddressV(benqi._address)
    ),

    new Fetcher<{ benqi: Benqi }, StringV>(`
        #### Name

        * "<Benqi> Name" - Returns the name of the Benqi token
          * E.g. "Benqi Name"
      `,
      "Name",
      [
        new Arg("benqi", getComp, { implicit: true })
      ],
      async (world, { benqi }) => new StringV(await benqi.methods.name().call())
    ),

    new Fetcher<{ benqi: Benqi }, StringV>(`
        #### Symbol

        * "<Benqi> Symbol" - Returns the symbol of the Benqi token
          * E.g. "Benqi Symbol"
      `,
      "Symbol",
      [
        new Arg("benqi", getComp, { implicit: true })
      ],
      async (world, { benqi }) => new StringV(await benqi.methods.symbol().call())
    ),

    new Fetcher<{ benqi: Benqi }, NumberV>(`
        #### Decimals

        * "<Benqi> Decimals" - Returns the number of decimals of the Benqi token
          * E.g. "Benqi Decimals"
      `,
      "Decimals",
      [
        new Arg("benqi", getComp, { implicit: true })
      ],
      async (world, { benqi }) => new NumberV(await benqi.methods.decimals().call())
    ),

    new Fetcher<{ benqi: Benqi }, NumberV>(`
        #### TotalSupply

        * "Benqi TotalSupply" - Returns Benqi token's total supply
      `,
      "TotalSupply",
      [
        new Arg("benqi", getComp, { implicit: true })
      ],
      async (world, { benqi }) => new NumberV(await benqi.methods.totalSupply().call())
    ),

    new Fetcher<{ benqi: Benqi, address: AddressV }, NumberV>(`
        #### TokenBalance

        * "Benqi TokenBalance <Address>" - Returns the Benqi token balance of a given address
          * E.g. "Benqi TokenBalance Geoff" - Returns Geoff's Benqi balance
      `,
      "TokenBalance",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("address", getAddressV)
      ],
      async (world, { benqi, address }) => new NumberV(await benqi.methods.balanceOf(address.val).call())
    ),

    new Fetcher<{ benqi: Benqi, owner: AddressV, spender: AddressV }, NumberV>(`
        #### Allowance

        * "Benqi Allowance owner:<Address> spender:<Address>" - Returns the Benqi allowance from owner to spender
          * E.g. "Benqi Allowance Geoff Torrey" - Returns the Benqi allowance of Geoff to Torrey
      `,
      "Allowance",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("owner", getAddressV),
        new Arg("spender", getAddressV)
      ],
      async (world, { benqi, owner, spender }) => new NumberV(await benqi.methods.allowance(owner.val, spender.val).call())
    ),

    new Fetcher<{ benqi: Benqi, account: AddressV }, NumberV>(`
        #### GetCurrentVotes

        * "Benqi GetCurrentVotes account:<Address>" - Returns the current Benqi votes balance for an account
          * E.g. "Benqi GetCurrentVotes Geoff" - Returns the current Benqi vote balance of Geoff
      `,
      "GetCurrentVotes",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("account", getAddressV),
      ],
      async (world, { benqi, account }) => new NumberV(await benqi.methods.getCurrentVotes(account.val).call())
    ),

    new Fetcher<{ benqi: Benqi, account: AddressV, blockNumber: NumberV }, NumberV>(`
        #### GetPriorVotes

        * "Benqi GetPriorVotes account:<Address> blockBumber:<Number>" - Returns the current Benqi votes balance at given block
          * E.g. "Benqi GetPriorVotes Geoff 5" - Returns the Benqi vote balance for Geoff at block 5
      `,
      "GetPriorVotes",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("account", getAddressV),
        new Arg("blockNumber", getNumberV),
      ],
      async (world, { benqi, account, blockNumber }) => new NumberV(await benqi.methods.getPriorVotes(account.val, blockNumber.encode()).call())
    ),

    new Fetcher<{ benqi: Benqi, account: AddressV }, NumberV>(`
        #### GetCurrentVotesBlock

        * "Benqi GetCurrentVotesBlock account:<Address>" - Returns the current Benqi votes checkpoint block for an account
          * E.g. "Benqi GetCurrentVotesBlock Geoff" - Returns the current Benqi votes checkpoint block for Geoff
      `,
      "GetCurrentVotesBlock",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("account", getAddressV),
      ],
      async (world, { benqi, account }) => {
        const numCheckpoints = Number(await benqi.methods.numCheckpoints(account.val).call());
        const checkpoint = await benqi.methods.checkpoints(account.val, numCheckpoints - 1).call();

        return new NumberV(checkpoint.fromBlock);
      }
    ),

    new Fetcher<{ benqi: Benqi, account: AddressV }, NumberV>(`
        #### VotesLength

        * "Benqi VotesLength account:<Address>" - Returns the Benqi vote checkpoint array length
          * E.g. "Benqi VotesLength Geoff" - Returns the Benqi vote checkpoint array length of Geoff
      `,
      "VotesLength",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("account", getAddressV),
      ],
      async (world, { benqi, account }) => new NumberV(await benqi.methods.numCheckpoints(account.val).call())
    ),

    new Fetcher<{ benqi: Benqi, account: AddressV }, ListV>(`
        #### AllVotes

        * "Benqi AllVotes account:<Address>" - Returns information about all votes an account has had
          * E.g. "Benqi AllVotes Geoff" - Returns the Benqi vote checkpoint array
      `,
      "AllVotes",
      [
        new Arg("benqi", getComp, { implicit: true }),
        new Arg("account", getAddressV),
      ],
      async (world, { benqi, account }) => {
        const numCheckpoints = Number(await benqi.methods.numCheckpoints(account.val).call());
        const checkpoints = await Promise.all(new Array(numCheckpoints).fill(undefined).map(async (_, i) => {
          const {fromBlock, votes} = await benqi.methods.checkpoints(account.val, i).call();

          return new StringV(`Block ${fromBlock}: ${votes} vote${votes !== 1 ? "s" : ""}`);
        }));

        return new ListV(checkpoints);
      }
    )
  ];
}

export async function getQiValue(world: World, event: Event): Promise<Value> {
  return await getFetcherValue<any, any>("Benqi", qiFetchers(), world, event);
}
