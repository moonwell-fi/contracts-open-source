pragma solidity 0.8.17;

import "../core/Governance/MoonwellApolloGovernor.sol";

contract GovernorApolloTestHarness is MoonwellGovernorApollo {
    constructor(
        address timelock_, 
        address well_,
        address distributor_,
        address safetyModule_,
        address breakGlassGuardian_,
        address governanceReturnAddress_,
        address governanceReturnGuardian_,
        uint guardianSunset_,
        uint currentQuorum_,
        uint lowerQuorumCap_,
        uint upperQuorumCap_
    ) MoonwellGovernorApollo(
        timelock_,
        well_,
        distributor_,
        safetyModule_,
        breakGlassGuardian_,
        governanceReturnAddress_,
        governanceReturnGuardian_,
        guardianSunset_,
        currentQuorum_,
        lowerQuorumCap_,
        upperQuorumCap_
      ) {
    }

  /// @notice Public function to expose adjust quorum for testing.
  function harnessAdjustQuorum() external {
    super._adjustQuorum();
  }


  /// @notice Public function that adds a proposal without checking proposal threshold or state requirements.
  /// NOTE: We implicitly initialize targets, values, signatures and calldatas to the empty array because adding them
  //        as parameters causes the solidity compiler to barf with 'callstack too deep'.
  function addProposal(
    uint eta,
    uint startTimestamp,
    uint endTimestamp,
    uint startBlock,
    uint forVotes,
    uint againstVotes,
    uint abstainVotes,
    bool canceled,
    bool executed,
    uint quorum,
    bool quorumAdjusted
  ) external {
    proposalCount++;

    Proposal storage newProposal = proposals[proposalCount];
    newProposal.id = proposalCount;

    newProposal.proposer = msg.sender;
    newProposal.eta = eta;
    newProposal.startTimestamp = startTimestamp;
    newProposal.endTimestamp = endTimestamp;
    newProposal.startBlock = startBlock;
    newProposal.forVotes = forVotes;
    newProposal.againstVotes = againstVotes;
    newProposal.abstainVotes = abstainVotes;
    newProposal.totalVotes = forVotes + againstVotes + abstainVotes;
    newProposal.canceled = canceled;
    newProposal.executed = executed;
    newProposal.quorum = quorum;
    newProposal.quorumAdjusted = quorumAdjusted;
  }
}