// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import "../libraries/ERC20.sol";

contract FaucetERC20 is ERC20 {

    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}