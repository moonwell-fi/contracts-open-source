pragma solidity 0.5.17;

import "../../contracts/ComptrollerG2.sol";

contract ComptrollerScenarioG2 is ComptrollerG2 {
    uint public blockTimestamp;
    address public qiAddress;

    constructor() ComptrollerG2() public {}

    function fastForward(uint blocks) public returns (uint) {
        blockTimestamp += blocks;
        return blockTimestamp;
    }

    function setBlockTimestamp(uint number) public {
        blockTimestamp = number;
    }
}
