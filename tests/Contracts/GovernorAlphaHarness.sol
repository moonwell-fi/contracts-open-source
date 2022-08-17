pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "../../contracts/Governance/MoonwellGovernorArtemis.sol";

contract MoonwellGovernorArtemisHarness is MoonwellGovernorArtemis {
    constructor(address timelock_, address comp_, address guardian_) MoonwellGovernorArtemis(timelock_, comp_, guardian_) public {}

    function votingPeriod() public pure returns (uint) { return 240; }
}
