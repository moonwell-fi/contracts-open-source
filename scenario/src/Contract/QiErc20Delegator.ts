import { Contract } from '../Contract';
import { Callable, Sendable } from '../Invokation';
import { QiTokenMethods } from './QiToken';
import { encodedNumber } from '../Encoding';

interface QiErc20DelegatorMethods extends QiTokenMethods {
  implementation(): Callable<string>;
  _setImplementation(
    implementation_: string,
    allowResign: boolean,
    becomImplementationData: string
  ): Sendable<void>;
}

interface QiErc20DelegatorScenarioMethods extends QiErc20DelegatorMethods {
  setTotalBorrows(amount: encodedNumber): Sendable<void>;
  setTotalReserves(amount: encodedNumber): Sendable<void>;
}

export interface QiErc20Delegator extends Contract {
  methods: QiErc20DelegatorMethods;
  name: string;
}

export interface QiErc20DelegatorScenario extends Contract {
  methods: QiErc20DelegatorMethods;
  name: string;
}
