import { Contract } from '../Contract';
import { encodedNumber } from '../Encoding';
import { Callable, Sendable } from '../Invokation';

export interface BenqiLensMethods {
  qiTokenBalances(qiToken: string, account: string): Sendable<[string,number,number,number,number,number]>;
  qiTokenBalancesAll(qiTokens: string[], account: string): Sendable<[string,number,number,number,number,number][]>;
  qiTokenMetadata(qiToken: string): Sendable<[string,number,number,number,number,number,number,number,number,boolean,number,string,number,number]>;
  qiTokenMetadataAll(qiTokens: string[]): Sendable<[string,number,number,number,number,number,number,number,number,boolean,number,string,number,number][]>;
  qiTokenUnderlyingPrice(qiToken: string): Sendable<[string,number]>;
  qiTokenUnderlyingPriceAll(qiTokens: string[]): Sendable<[string,number][]>;
  getAccountLimits(comptroller: string, account: string): Sendable<[string[],number,number]>;
}

export interface BenqiLens extends Contract {
  methods: BenqiLensMethods;
  name: string;
}
