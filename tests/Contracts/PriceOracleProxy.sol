pragma solidity 0.5.17;

import "../../contracts/QiErc20.sol";
import "../../contracts/QiToken.sol";
import "../../contracts/PriceOracle.sol";

interface V1PriceOracleInterface {
    function assetPrices(address asset) external view returns (uint);
}

contract PriceOracleProxy is PriceOracle {
    /// @notice Indicator that this is a PriceOracle contract (for inspection)
    bool public constant isPriceOracle = true;

    /// @notice The v1 price oracle, which will continue to serve prices for v1 assets
    V1PriceOracleInterface public v1PriceOracle;

    /// @notice Address of the guardian, which may set the SAI price once
    address public guardian;

    /// @notice Address of the qiAvax contract, which has a constant price
    address public qiAvaxAddress;

    /// @notice Address of the qiUSDC contract, which we hand pick a key for
    address public qiUsdcAddress;

    /// @notice Address of the qiUSDT contract, which uses the qiUSDC price
    address public qiUsdtAddress;

    /// @notice Address of the qiSAI contract, which may have its price set
    address public qiSaiAddress;

    /// @notice Address of the qiDAI contract, which we hand pick a key for
    address public qiDaiAddress;

    /// @notice Handpicked key for USDC
    address public constant usdcOracleKey = address(1);

    /// @notice Handpicked key for DAI
    address public constant daiOracleKey = address(2);

    /// @notice Frozen SAI price (or 0 if not set yet)
    uint public saiPrice;

    /**
     * @param guardian_ The address of the guardian, which may set the SAI price once
     * @param v1PriceOracle_ The address of the v1 price oracle, which will continue to operate and hold prices for collateral assets
     * @param qiAvaxAddress_ The address of qiAVAX, which will return a constant 1e18, since all prices relative to avax
     * @param qiUsdcAddress_ The address of qiUSDC, which will be read from a special oracle key
     * @param qiSaiAddress_ The address of qiSAI, which may be read directly from storage
     * @param qiDaiAddress_ The address of qiDAI, which will be read from a special oracle key
     * @param qiUsdtAddress_ The address of qiUSDT, which uses the qiUSDC price
     */
    constructor(address guardian_,
                address v1PriceOracle_,
                address qiAvaxAddress_,
                address qiUsdcAddress_,
                address qiSaiAddress_,
                address qiDaiAddress_,
                address qiUsdtAddress_) public {
        guardian = guardian_;
        v1PriceOracle = V1PriceOracleInterface(v1PriceOracle_);

        qiAvaxAddress = qiAvaxAddress_;
        qiUsdcAddress = qiUsdcAddress_;
        qiSaiAddress = qiSaiAddress_;
        qiDaiAddress = qiDaiAddress_;
        qiUsdtAddress = qiUsdtAddress_;
    }

    /**
     * @notice Get the underlying price of a listed qiToken asset
     * @param qiToken The qiToken to get the underlying price of
     * @return The underlying asset price mantissa (scaled by 1e18)
     */
    function getUnderlyingPrice(QiToken qiToken) public view returns (uint) {
        address qiTokenAddress = address(qiToken);

        if (qiTokenAddress == qiAvaxAddress) {
            // avax always worth 1
            return 1e18;
        }

        if (qiTokenAddress == qiUsdcAddress || qiTokenAddress == qiUsdtAddress) {
            return v1PriceOracle.assetPrices(usdcOracleKey);
        }

        if (qiTokenAddress == qiDaiAddress) {
            return v1PriceOracle.assetPrices(daiOracleKey);
        }

        if (qiTokenAddress == qiSaiAddress) {
            // use the frozen SAI price if set, otherwise use the DAI price
            return saiPrice > 0 ? saiPrice : v1PriceOracle.assetPrices(daiOracleKey);
        }

        // otherwise just read from v1 oracle
        address underlying = QiErc20(qiTokenAddress).underlying();
        return v1PriceOracle.assetPrices(underlying);
    }

    /**
     * @notice Set the price of SAI, permanently
     * @param price The price for SAI
     */
    function setSaiPrice(uint price) public {
        require(msg.sender == guardian, "only guardian may set the SAI price");
        require(saiPrice == 0, "SAI price may only be set once");
        require(price < 0.1e18, "SAI price must be < 0.1 AVAX");
        saiPrice = price;
    }
}
