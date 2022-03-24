// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import "./interfaces/IERC20.sol";
import "./interfaces/IEcosystemReserve.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";
import {Initializable} from "./utils/Initializable.sol";

/**
 * @title EcosystemReserve
 * 
 * This contract embeds logic for UpgradeableReentrancyGuard in the contract rather than inheriting. This is
 * to work around storage layout incompatibilities because the Moonriver contracts were deployed without a reentrancy
 * guard.
 *
 * @notice Stores all the mTokens kept for incentives, just adding different systems to whitelist
 * that will pull MFAM funds for their specific use case
 * @author Moonwell
 */
contract EcosystemReserveMoonriver is IEcosystemReserve, Initializable {
    /**
     * EcosystemReserveMoonriver
     * 
     * Code below this line is copied verbatim from EcosystemReserve.sol
     */

    using SafeERC20 for IERC20;

    address internal _fundsAdmin;

    event NewFundsAdmin(address indexed fundsAdmin);

    function getFundsAdmin() external view returns (address) {
        return _fundsAdmin;
    }

    modifier onlyFundsAdmin() {
        require(msg.sender == _fundsAdmin, "ONLY_BY_FUNDS_ADMIN");
        _;
    }

    function initialize(address reserveController) external initializer {
        require(reserveController != address(0), "ZERO_ADDRESS");
        _setFundsAdmin(reserveController);
    }

    function approve(
        IERC20 token,
        address recipient,
        uint256 amount
    ) external override onlyFundsAdmin {
        token.approve(recipient, amount);
    }

    function transfer(
        IERC20 token,
        address recipient,
        uint256 amount
    ) external override onlyFundsAdmin nonReentrant {
        token.transfer(recipient, amount);
    }

    function setFundsAdmin(address admin) external override onlyFundsAdmin {
        _setFundsAdmin(admin);
    }

    function _setFundsAdmin(address admin) internal {
        require(admin != address(0), "ZERO_ADDRESS");
        _fundsAdmin = admin;
        emit NewFundsAdmin(admin);
    }

    /**
     * ReentrancyGuardUpgradeable
     * 
     * Code below this line is copied verbatim from ReentrancyGuardUpgradeable.sol
     */

    modifier nonReentrant() {
        // On the first call to nonReentrant, _notEntered will be true
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");

        // Any calls to nonReentrant after this point will fail
        _status = _ENTERED;

        _;

        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = _NOT_ENTERED;
    }

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;
}