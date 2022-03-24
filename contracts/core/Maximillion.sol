pragma solidity 0.5.17;

import "./MGlimmer.sol";

/**
 * @title Moonwell's Maximillion Contract
 * @author Moonwell
 */
contract Maximillion {
    /**
     * @notice The default mGlimmer market to repay in
     */
    MGlimmer public mGlimmer;

    /**
     * @notice Construct a Maximillion to repay max in a MGlimmer market
     */
    constructor(MGlimmer mGlimmer_) public {
        mGlimmer = mGlimmer_;
    }

    /**
     * @notice msg.sender sends Glmr to repay an account's borrow in the mGlimmer market
     * @dev The provided Glmr is applied towards the borrow balance, any excess is refunded
     * @param borrower The address of the borrower account to repay on behalf of
     */
    function repayBehalf(address borrower) public payable {
        repayBehalfExplicit(borrower, mGlimmer);
    }

    /**
     * @notice msg.sender sends Glmr to repay an account's borrow in a mGlimmer market
     * @dev The provided Glmr is applied towards the borrow balance, any excess is refunded
     * @param borrower The address of the borrower account to repay on behalf of
     * @param mGlimmer_ The address of the mGlimmer contract to repay in
     */
    function repayBehalfExplicit(address borrower, MGlimmer mGlimmer_) public payable {
        uint received = msg.value;
        uint borrows = mGlimmer_.borrowBalanceCurrent(borrower);
        if (received > borrows) {
            mGlimmer_.repayBorrowBehalf.value(borrows)(borrower);
            msg.sender.transfer(received - borrows);
        } else {
            mGlimmer_.repayBorrowBehalf.value(received)(borrower);
        }
    }
}
