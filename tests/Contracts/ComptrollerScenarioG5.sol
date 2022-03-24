pragma solidity 0.5.17;

import "../../contracts/ComptrollerG5.sol";

contract ComptrollerScenarioG5 is ComptrollerG5 {
    uint public blockTimestamp;
    address public qiAddress;

    constructor() ComptrollerG5() public {}

    function setQiAddress(address qiAddress_) public {
        qiAddress = qiAddress_;
    }

    function getQiAddress() public view returns (address) {
        return qiAddress;
    }

    function membershipLength(QiToken qiToken) public view returns (uint) {
        return accountAssets[address(qiToken)].length;
    }

    function fastForward(uint blocks) public returns (uint) {
        blockTimestamp += blocks;

        return blockTimestamp;
    }

    function setBlockTimestamp(uint number) public {
        blockTimestamp = number;
    }

    function getBlockTimestamp() public view returns (uint) {
        return blockTimestamp;
    }

    function getQiMarkets() public view returns (address[] memory) {
        uint m = allMarkets.length;
        uint n = 0;
        for (uint i = 0; i < m; i++) {
            if (markets[address(allMarkets[i])].isQied) {
                n++;
            }
        }

        address[] memory qiMarkets = new address[](n);
        uint k = 0;
        for (uint i = 0; i < m; i++) {
            if (markets[address(allMarkets[i])].isQied) {
                qiMarkets[k++] = address(allMarkets[i]);
            }
        }
        return qiMarkets;
    }

    function unlist(QiToken qiToken) public {
        markets[address(qiToken)].isListed = false;
    }
}
