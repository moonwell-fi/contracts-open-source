pragma solidity 0.5.17;

import "../../contracts/ComptrollerG1.sol";
import "../../contracts/PriceOracle.sol";

// XXX we should delete G1 everything...
//  requires fork/deploy bytecode tests

contract ComptrollerScenarioG1 is ComptrollerG1 {
    uint public blockTimestamp;

    constructor() ComptrollerG1() public {}

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

    function _become(
        Unitroller unitroller,
        PriceOracle _oracle,
        uint _closeFactorMantissa,
        uint _maxAssets,
        bool reinitializing) public {
        super._become(unitroller, _oracle, _closeFactorMantissa, _maxAssets, reinitializing);
    }

    function getHypotheticalAccountLiquidity(
        address account,
        address qiTokenModify,
        uint redeemTokens,
        uint borrowAmount) public view returns (uint, uint, uint) {
        (Error err, uint liquidity, uint shortfall) =
            super.getHypotheticalAccountLiquidityInternal(account, QiToken(qiTokenModify), redeemTokens, borrowAmount);
        return (uint(err), liquidity, shortfall);
    }

    function unlist(QiToken qiToken) public {
        markets[address(qiToken)].isListed = false;
    }
}
