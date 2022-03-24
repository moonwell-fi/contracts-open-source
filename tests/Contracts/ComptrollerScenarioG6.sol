pragma solidity 0.5.17;

import "../../contracts/ComptrollerG6.sol";

contract ComptrollerScenarioG6 is ComptrollerG6 {
    uint public blockTimestamp;
    address public qiAddress;

    constructor() ComptrollerG6() public {}

    function fastForward(uint blocks) public returns (uint) {
        blockTimestamp += blocks;
        return blockTimestamp;
    }

    function setQiAddress(address qiAddress_) public {
        qiAddress = qiAddress_;
    }

    function getQiAddress() public view returns (address) {
        return qiAddress;
    }

    function setBlockTimestamp(uint number) public {
        blockTimestamp = number;
    }

    function getBlockTimestamp() public view returns (uint) {
        return blockTimestamp;
    }

    function membershipLength(QiToken qiToken) public view returns (uint) {
        return accountAssets[address(qiToken)].length;
    }

    function unlist(QiToken qiToken) public {
        markets[address(qiToken)].isListed = false;
    }

    function setQiSpeed(address qiToken, uint qiSpeed) public {
        qiSpeeds[qiToken] = qiSpeed;
    }
}
