pragma solidity 0.5.17;

import "../../contracts/Comptroller.sol";
import "../../contracts/PriceOracle.sol";

contract ComptrollerKovan is Comptroller {
  function getQiAddress() public view returns (address) {
    return 0x61460874a7196d6a22D1eE4922473664b3E95270;
  }
}

contract ComptrollerRopsten is Comptroller {
  function getQiAddress() public view returns (address) {
    return 0x1Fe16De955718CFAb7A44605458AB023838C2793;
  }
}

contract ComptrollerHarness is Comptroller {
    address qiAddress;
    uint public blockTimestamp;

    constructor() Comptroller() public {}

    function setPauseGuardian(address harnessedPauseGuardian) public {
        pauseGuardian = harnessedPauseGuardian;
    }

    function setQiSupplyState(address qiToken, uint224 index, uint32 blockTimestamp_) public {
        qiSupplyState[qiToken].index = index;
        qiSupplyState[qiToken].timestamp = blockTimestamp_;
    }

    function setQiBorrowState(address qiToken, uint224 index, uint32 blockTimestamp_) public {
        qiBorrowState[qiToken].index = index;
        qiBorrowState[qiToken].timestamp = blockTimestamp_;
    }

    function setQiAccrued(address user, uint userAccrued) public {
        qiAccrued[user] = userAccrued;
    }

    function setQiAddress(address qiAddress_) public {
        qiAddress = qiAddress_;
    }

    function getQiAddress() public view returns (address) {
        return qiAddress;
    }

    /**
     * @notice Set the amount of BENQI distributed per timestmp
     * @param qiRate_ The amount of BENQI wei per timestmp to distribute
     */
    function harnessSetQiRate(uint qiRate_) public {
        qiRate = qiRate_;
    }

    /**
     * @notice Recalculate and update BENQI speeds for all BENQI markets
     */
    function harnessRefreshQiSpeeds() public {
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

    function setQiBorrowerIndex(address qiToken, address borrower, uint index) public {
        qiBorrowerIndex[qiToken][borrower] = index;
    }

    function setQiSupplierIndex(address qiToken, address supplier, uint index) public {
        qiSupplierIndex[qiToken][supplier] = index;
    }

    function harnessDistributeAllBorrowerQi(address qiToken, address borrower, uint marketBorrowIndexMantissa) public {
        distributeBorrowerQi(qiToken, borrower, Exp({mantissa: marketBorrowIndexMantissa}));
        qiAccrued[borrower] = grantQiInternal(borrower, qiAccrued[borrower]);
    }

    function harnessDistributeAllSupplierQi(address qiToken, address supplier) public {
        distributeSupplierQi(qiToken, supplier);
        qiAccrued[supplier] = grantQiInternal(supplier, qiAccrued[supplier]);
    }

    function harnessUpdateQiBorrowIndex(address qiToken, uint marketBorrowIndexMantissa) public {
        updateQiBorrowIndex(qiToken, Exp({mantissa: marketBorrowIndexMantissa}));
    }

    function harnessUpdateQiSupplyIndex(address qiToken) public {
        updateQiSupplyIndex(qiToken);
    }

    function harnessDistributeBorrowerQi(address qiToken, address borrower, uint marketBorrowIndexMantissa) public {
        distributeBorrowerQi(qiToken, borrower, Exp({mantissa: marketBorrowIndexMantissa}));
    }

    function harnessDistributeSupplierQi(address qiToken, address supplier) public {
        distributeSupplierQi(qiToken, supplier);
    }

    function harnessTransferComp(address user, uint userAccrued, uint threshold) public returns (uint) {
        if (userAccrued > 0 && userAccrued >= threshold) {
            return grantQiInternal(user, userAccrued);
        }
        return userAccrued;
    }

    function harnessAddQiMarkets(address[] memory qiTokens) public {
        for (uint i = 0; i < qiTokens.length; i++) {
            // temporarily set qiSpeed to 1 (will be fixed by `harnessRefreshQiSpeeds`)
            setQiSpeedInternal(QiToken(qiTokens[i]), 1);
        }
    }

    function harnessFastForward(uint blocks) public returns (uint) {
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
            if (qiSpeeds[address(allMarkets[i])] > 0) {
                n++;
            }
        }

        address[] memory qiMarkets = new address[](n);
        uint k = 0;
        for (uint i = 0; i < m; i++) {
            if (qiSpeeds[address(allMarkets[i])] > 0) {
                qiMarkets[k++] = address(allMarkets[i]);
            }
        }
        return qiMarkets;
    }
}

contract ComptrollerBorked {
    function _become(Unitroller unitroller, PriceOracle _oracle, uint _closeFactorMantissa, uint _maxAssets, bool _reinitializing) public {
        _oracle;
        _closeFactorMantissa;
        _maxAssets;
        _reinitializing;

        require(msg.sender == unitroller.admin(), "only unitroller admin can change brains");
        unitroller._acceptImplementation();
    }
}

contract BoolComptroller is ComptrollerInterface {
    bool allowMint = true;
    bool allowRedeem = true;
    bool allowBorrow = true;
    bool allowRepayBorrow = true;
    bool allowLiquidateBorrow = true;
    bool allowSeize = true;
    bool allowTransfer = true;

    bool verifyMint = true;
    bool verifyRedeem = true;
    bool verifyBorrow = true;
    bool verifyRepayBorrow = true;
    bool verifyLiquidateBorrow = true;
    bool verifySeize = true;
    bool verifyTransfer = true;

    bool failCalculateSeizeTokens;
    uint calculatedSeizeTokens;

    uint noError = 0;
    uint opaqueError = noError + 11; // an arbitrary, opaque error code

    /*** Assets You Are In ***/

    function enterMarkets(address[] calldata _qiTokens) external returns (uint[] memory) {
        _qiTokens;
        uint[] memory ret;
        return ret;
    }

    function exitMarket(address _qiToken) external returns (uint) {
        _qiToken;
        return noError;
    }

    /*** Policy Hooks ***/

    function mintAllowed(address _qiToken, address _minter, uint _mintAmount) public returns (uint) {
        _qiToken;
        _minter;
        _mintAmount;
        return allowMint ? noError : opaqueError;
    }

    function mintVerify(address _qiToken, address _minter, uint _mintAmount, uint _mintTokens) external {
        _qiToken;
        _minter;
        _mintAmount;
        _mintTokens;
        require(verifyMint, "mintVerify rejected mint");
    }

    function redeemAllowed(address _qiToken, address _redeemer, uint _redeemTokens) public returns (uint) {
        _qiToken;
        _redeemer;
        _redeemTokens;
        return allowRedeem ? noError : opaqueError;
    }

    function redeemVerify(address _qiToken, address _redeemer, uint _redeemAmount, uint _redeemTokens) external {
        _qiToken;
        _redeemer;
        _redeemAmount;
        _redeemTokens;
        require(verifyRedeem, "redeemVerify rejected redeem");
    }

    function borrowAllowed(address _qiToken, address _borrower, uint _borrowAmount) public returns (uint) {
        _qiToken;
        _borrower;
        _borrowAmount;
        return allowBorrow ? noError : opaqueError;
    }

    function borrowVerify(address _qiToken, address _borrower, uint _borrowAmount) external {
        _qiToken;
        _borrower;
        _borrowAmount;
        require(verifyBorrow, "borrowVerify rejected borrow");
    }

    function repayBorrowAllowed(
        address _qiToken,
        address _payer,
        address _borrower,
        uint _repayAmount) public returns (uint) {
        _qiToken;
        _payer;
        _borrower;
        _repayAmount;
        return allowRepayBorrow ? noError : opaqueError;
    }

    function repayBorrowVerify(
        address _qiToken,
        address _payer,
        address _borrower,
        uint _repayAmount,
        uint _borrowerIndex) external {
        _qiToken;
        _payer;
        _borrower;
        _repayAmount;
        _borrowerIndex;
        require(verifyRepayBorrow, "repayBorrowVerify rejected repayBorrow");
    }

    function liquidateBorrowAllowed(
        address _qiTokenBorrowed,
        address _qiTokenCollateral,
        address _liquidator,
        address _borrower,
        uint _repayAmount) public returns (uint) {
        _qiTokenBorrowed;
        _qiTokenCollateral;
        _liquidator;
        _borrower;
        _repayAmount;
        return allowLiquidateBorrow ? noError : opaqueError;
    }

    function liquidateBorrowVerify(
        address _qiTokenBorrowed,
        address _qiTokenCollateral,
        address _liquidator,
        address _borrower,
        uint _repayAmount,
        uint _seizeTokens) external {
        _qiTokenBorrowed;
        _qiTokenCollateral;
        _liquidator;
        _borrower;
        _repayAmount;
        _seizeTokens;
        require(verifyLiquidateBorrow, "liquidateBorrowVerify rejected liquidateBorrow");
    }

    function seizeAllowed(
        address _qiTokenCollateral,
        address _qiTokenBorrowed,
        address _borrower,
        address _liquidator,
        uint _seizeTokens) public returns (uint) {
        _qiTokenCollateral;
        _qiTokenBorrowed;
        _liquidator;
        _borrower;
        _seizeTokens;
        return allowSeize ? noError : opaqueError;
    }

    function seizeVerify(
        address _qiTokenCollateral,
        address _qiTokenBorrowed,
        address _liquidator,
        address _borrower,
        uint _seizeTokens) external {
        _qiTokenCollateral;
        _qiTokenBorrowed;
        _liquidator;
        _borrower;
        _seizeTokens;
        require(verifySeize, "seizeVerify rejected seize");
    }

    function transferAllowed(
        address _qiToken,
        address _src,
        address _dst,
        uint _transferTokens) public returns (uint) {
        _qiToken;
        _src;
        _dst;
        _transferTokens;
        return allowTransfer ? noError : opaqueError;
    }

    function transferVerify(
        address _qiToken,
        address _src,
        address _dst,
        uint _transferTokens) external {
        _qiToken;
        _src;
        _dst;
        _transferTokens;
        require(verifyTransfer, "transferVerify rejected transfer");
    }

    /*** Special Liquidation Calculation ***/

    function liquidateCalculateSeizeTokens(
        address _qiTokenBorrowed,
        address _qiTokenCollateral,
        uint _repayAmount) public view returns (uint, uint) {
        _qiTokenBorrowed;
        _qiTokenCollateral;
        _repayAmount;
        return failCalculateSeizeTokens ? (opaqueError, 0) : (noError, calculatedSeizeTokens);
    }

    /**** Mock Settors ****/

    /*** Policy Hooks ***/

    function setMintAllowed(bool allowMint_) public {
        allowMint = allowMint_;
    }

    function setMintVerify(bool verifyMint_) public {
        verifyMint = verifyMint_;
    }

    function setRedeemAllowed(bool allowRedeem_) public {
        allowRedeem = allowRedeem_;
    }

    function setRedeemVerify(bool verifyRedeem_) public {
        verifyRedeem = verifyRedeem_;
    }

    function setBorrowAllowed(bool allowBorrow_) public {
        allowBorrow = allowBorrow_;
    }

    function setBorrowVerify(bool verifyBorrow_) public {
        verifyBorrow = verifyBorrow_;
    }

    function setRepayBorrowAllowed(bool allowRepayBorrow_) public {
        allowRepayBorrow = allowRepayBorrow_;
    }

    function setRepayBorrowVerify(bool verifyRepayBorrow_) public {
        verifyRepayBorrow = verifyRepayBorrow_;
    }

    function setLiquidateBorrowAllowed(bool allowLiquidateBorrow_) public {
        allowLiquidateBorrow = allowLiquidateBorrow_;
    }

    function setLiquidateBorrowVerify(bool verifyLiquidateBorrow_) public {
        verifyLiquidateBorrow = verifyLiquidateBorrow_;
    }

    function setSeizeAllowed(bool allowSeize_) public {
        allowSeize = allowSeize_;
    }

    function setSeizeVerify(bool verifySeize_) public {
        verifySeize = verifySeize_;
    }

    function setTransferAllowed(bool allowTransfer_) public {
        allowTransfer = allowTransfer_;
    }

    function setTransferVerify(bool verifyTransfer_) public {
        verifyTransfer = verifyTransfer_;
    }

    /*** Liquidity/Liquidation Calculations ***/

    function setCalculatedSeizeTokens(uint seizeTokens_) public {
        calculatedSeizeTokens = seizeTokens_;
    }

    function setFailCalculateSeizeTokens(bool shouldFail) public {
        failCalculateSeizeTokens = shouldFail;
    }
}

contract EchoTypesComptroller is UnitrollerAdminStorage {
    function stringy(string memory s) public pure returns(string memory) {
        return s;
    }

    function addresses(address a) public pure returns(address) {
        return a;
    }

    function booly(bool b) public pure returns(bool) {
        return b;
    }

    function listOInts(uint[] memory u) public pure returns(uint[] memory) {
        return u;
    }

    function reverty() public pure {
        require(false, "gotcha sucka");
    }

    function becomeBrains(address payable unitroller) public {
        Unitroller(unitroller)._acceptImplementation();
    }
}
