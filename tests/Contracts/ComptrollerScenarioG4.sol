pragma solidity 0.5.17;

import "../../contracts/ComptrollerG4.sol";

contract ComptrollerScenarioG4 is ComptrollerG4 {
    uint public blockTimestamp;
    address public qiAddress;

    constructor() ComptrollerG4() public {}

    function fastForward(uint blocks) public returns (uint) {
        blockTimestamp += blocks;
        return blockTimestamp;
    }

    function setBlockTimestamp(uint number) public {
        blockTimestamp = number;
    }

    function membershipLength(QiToken qiToken) public view returns (uint) {
        return accountAssets[address(qiToken)].length;
    }

    function unlist(QiToken qiToken) public {
        markets[address(qiToken)].isListed = false;
    }
}
