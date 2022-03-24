pragma solidity 0.5.17;

import "../../contracts/Comptroller.sol";

contract ComptrollerScenario is Comptroller {
    uint public blockTimestamp;
    address public qiAddress;

    constructor() Comptroller() public {}

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

    /**
     * @notice Recalculate and update BENQI speeds for all BENQI markets
     */
    function refreshQiSpeeds() public {
        QiToken[] memory allMarkets_ = allMarkets;

        for (uint i = 0; i < allMarkets_.length; i++) {
            QiToken qiToken = allMarkets_[i];
            Exp memory borrowIndex = Exp({mantissa: qiToken.borrowIndex()});
            updateQiSupplyIndex(address(qiToken));
            updateQiBorrowIndex(address(qiToken), borrowIndex);
        }

        Exp memory totalUtility = Exp({mantissa: 0});
        Exp[] memory utilities = new Exp[](allMarkets_.length);
        for (uint i = 0; i < allMarkets_.length; i++) {
            QiToken qiToken = allMarkets_[i];
            if (qiSpeeds[address(qiToken)] > 0) {
                Exp memory assetPrice = Exp({mantissa: oracle.getUnderlyingPrice(qiToken)});
                Exp memory utility = mul_(assetPrice, qiToken.totalBorrows());
                utilities[i] = utility;
                totalUtility = add_(totalUtility, utility);
            }
        }

        for (uint i = 0; i < allMarkets_.length; i++) {
            QiToken qiToken = allMarkets[i];
            uint newSpeed = totalUtility.mantissa > 0 ? mul_(qiRate, div_(utilities[i], totalUtility)) : 0;
            setQiSpeedInternal(qiToken, newSpeed);
        }
    }
}
