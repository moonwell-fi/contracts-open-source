import { Contract } from '../Contract';
import { Sendable } from '../Invokation';
import { QiTokenMethods, QiTokenScenarioMethods } from './QiToken';

interface QiErc20DelegateMethods extends QiTokenMethods {
  _becomeImplementation(data: string): Sendable<void>;
  _resignImplementation(): Sendable<void>;
}

interface QiErc20DelegateScenarioMethods extends QiTokenScenarioMethods {
  _becomeImplementation(data: string): Sendable<void>;
  _resignImplementation(): Sendable<void>;
}

export interface QiErc20Delegate extends Contract {
  methods: QiErc20DelegateMethods;
  name: string;
}

export interface QiErc20DelegateScenario extends Contract {
  methods: QiErc20DelegateScenarioMethods;
  name: string;
}
