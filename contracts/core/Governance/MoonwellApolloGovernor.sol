pragma solidity 0.8.17;

import "./IERC20.sol";

contract MoonwellGovernorApollo {
    /// @notice The name of this contract
    string public constant name = "Moonwell Apollo Governor";

    /// @notice Values for votes
    uint8 public constant voteValueYes = 0;
    uint8 public constant voteValueNo = 1;
    uint8 public constant voteValueAbstain = 2;

    /// @notice The number of votes for a proposal required in order for a quorum to be reached and for a vote to succeed
    uint public currentQuorum;

    /// @notice The upper limit on quorum.
    uint public upperQuorumCap;

    /// @notice The lower limit on quorum.
    uint public lowerQuorumCap;

    /// @notice The high water mark for proposals which have adjusted quorum. When adjusting quorum, this is the
    ///         starting proposal to search for completed proposals that will change quorum.
    uint public lastQuorumAdjustment;

    /// @notice The number of votes required in order for a voter to become a proposer
    uint public proposalThreshold = 400000e18; // 400,000 WELL

    /// @notice The maximum number of actions that can be included in a proposal
    uint public proposalMaxOperations = 25; // 25 actions
    
    /// @notice The delay before voting on a proposal may take place, once proposed
    uint public votingDelay = 60 seconds;

    /// @notice The duration of voting on a proposal, in blocks
    uint public votingPeriod = 3 days;

    /// @notice The address of the Well Protocol Timelock
    TimelockInterface public timelock;

    /// @notice The address of the Well governance token
    GovTokenInterface public govToken;

    /// @notice The address of the Distributor contract
    SnapshotInterface public distributor;

    /// @notice The address of the Safety Module contract
    SnapshotInterface public safetyModule;

    /// @notice The total number of proposals
    uint public proposalCount;

    /// @notice The address of the Break Glass Guardian
    /// This address can opt to call '_executeBreakGlass*' which will execute an operation to return governance to
    /// the governance return addres in the event a bug is found in governnce.
    address public breakGlassGuardian;

    /// @notice An address that can set the governance return address.
    address public governanceReturnGuardian;

    /// @notice The address that will receive control of governance when glass is broken.
    address public governanceReturnAddress;

    /// @notice The timestamp when guardians may be stripped of their power through a vote.
    uint256 public guardianSunset;

    struct Proposal {
        /// @notice Unique id for looking up a proposal
        uint id;

        /// @notice Creator of the proposal
        address proposer;

        /// @notice The timestamp that the proposal will be available for execution, set once the vote succeeds
        uint eta;

        /// @notice the ordered list of target addresses for calls to be made
        address[] targets;

        /// @notice The ordered list of values (i.e. msg.value) to be passed to the calls to be made
        uint[] values;

        /// @notice The ordered list of function signatures to be called
        string[] signatures;

        /// @notice The ordered list of calldata to be passed to each call
        bytes[] calldatas;

        /// @notice The timestamp at which voting begins: holders must delegate their votes prior to this time
        uint startTimestamp;

        /// @notice The timestamp at which voting ends: votes must be cast prior to this time
        uint endTimestamp;

        /// @notice The block at which voting began: holders must have delegated their votes prior to this block
        uint startBlock;

        /// @notice Current number of votes in favor of this proposal
        uint forVotes;

        /// @notice Current number of votes in opposition to this proposal
        uint againstVotes;

        /// @notice Current number of votes in abstention to this proposal
        uint abstainVotes;

        /// @notice The total votes on a proposal.
        uint totalVotes;

        /// @notice Flag marking whether the proposal has been canceled
        bool canceled;

        /// @notice Flag marking whether the proposal has been executed
        bool executed;

        /// @notice The quorum required for the proposal to pass.
        uint256 quorum;

        /// @notice Whether this proposal has been taken into account for floating quorum adjustments.
        bool quorumAdjusted;        

        /// @notice Receipts of ballots for the entire set of voters
        mapping (address => Receipt) receipts;
    }

    /// @notice Ballot receipt record for a voter
    struct Receipt {
        /// @notice Whether or not a vote has been cast
        bool hasVoted;

        /// @notice The value of the vote.
        uint8 voteValue;

        /// @notice The number of votes the voter had, which were cast
        uint votes;
    }

    /// @notice Possible states that a proposal may be in
    enum ProposalState {
        Pending,
        Active,
        Canceled,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }

    /// @notice The official record of all proposals ever proposed
    mapping (uint => Proposal) public proposals;

    /// @notice The latest proposal for each proposer
    mapping (address => uint) public latestProposalIds;

    /// @notice The EIP-712 typehash for the contract's domain
    bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");

    /// @notice The EIP-712 typehash for the ballot struct used by the contract
    bytes32 public constant BALLOT_TYPEHASH = keccak256("Ballot(uint256 proposalId,uint8 voteValue)");

    /// @notice An event emitted when a new proposal is created
    event ProposalCreated(uint id, address proposer, address[] targets, uint[] values, string[] signatures, bytes[] calldatas, uint startTimestamp, uint endTimestamp, string description, uint quorum);

    /// @notice An event emitted when the first vote is cast in a proposal
    event StartBlockSet(uint proposalId, uint startBlock);

    /// @notice An event emitted when a vote has been cast on a proposal
    event VoteCast(address voter, uint proposalId, uint8 voteValue, uint votes);

    /// @notice An event emitted when a proposal has been canceled
    event ProposalCanceled(uint id);

    /// @notice An event emitted when a proposal has been queued in the Timelock
    event ProposalQueued(uint id, uint eta);

    /// @notice An event emitted when a proposal has been executed in the Timelock
    event ProposalExecuted(uint id);

    /// @notice An event emitted when thee quorum votes is changed.
    event QuroumVotesChanged(uint256 oldValue, uint256 newValue);

    /// @notice An event emitted when the proposal threshold is changed.
    event ProposalThresholdChanged(uint256 oldValue, uint256 newValue);

    /// @notice An event emitted when the proposal max operations is changed.
    event ProposalMaxOperationsChanged(uint256 oldValue, uint256 newValue);

    /// @notice An event emitted when the voting delay is changed.
    event VotingDelayChanged(uint256 oldValue, uint256 newValue);

    /// @notice An event emitted when the voting period is changed.
    event VotingPeriodChanged(uint256 oldValue, uint256 newValue);

    /// @notice An event emitted when the break glass guardian is changed.
    event BreakGlassGuardianChanged(address oldValue, address newValue);

    /// @notice An event emitted when the governance return address is changed.
    event GovernanceReturnAddressChanged(address oldValue, address newValue);

    /// @notice The lower quorum cap was changed.
    event LowerQuorumCapChanged(uint oldValue, uint newValue);

    /// @notice The upper quorum cap was changed.
    event UpperQuorumCapChanged(uint oldValue, uint newValue);

    /// @notice Construct a new Governor.
    /// @param timelock_ The address of the timelock
    /// @param govToken_ The address of the governance token.
    /// @param distributor_ The address of the token distributor contract used for vesting.
    /// @param safetyModule_ The address of the safety module used for staking governance tokens.
    /// @param breakGlassGuardian_ The address of the break glass guardian.
    /// @param governanceReturnAddress_ The address to return governance to in case of emergency.
    /// @param governanceReturnGuardian_ The address of the governance return guardian. 
    /// @param guardianSunset_ The time that governance guardians become eligible to be removed.
    /// @param currentQuorum_ The initial value to use for quorum. 
    /// @param lowerQuorumCap_ The initial lower value to bound quorum to.
    /// @param upperQuorumCap_ The initial upper value to bound quorum to.
    constructor(
        address timelock_, 
        address govToken_,
        address distributor_,
        address safetyModule_,
        address breakGlassGuardian_,
        address governanceReturnAddress_,
        address governanceReturnGuardian_,
        uint guardianSunset_,
        uint currentQuorum_,
        uint lowerQuorumCap_,
        uint upperQuorumCap_
    ) {
        timelock = TimelockInterface(timelock_);
        govToken = GovTokenInterface(govToken_);
        distributor = SnapshotInterface(distributor_);
        safetyModule = SnapshotInterface(safetyModule_);
        breakGlassGuardian = breakGlassGuardian_;
        governanceReturnAddress = governanceReturnAddress_;
        governanceReturnGuardian = governanceReturnGuardian_;
        guardianSunset = guardianSunset_;
        lastQuorumAdjustment = 0;
        currentQuorum = currentQuorum_;
        lowerQuorumCap = lowerQuorumCap_;
        upperQuorumCap = upperQuorumCap_;
    }

    /// @notice Create a new governance proposal.
    /// @param targets Addresses of target contracts. 
    /// @param values The amount of native asset to send to each target with the call.
    /// @param signatures Function signatures to call on the targets.
    /// @param calldatas Call data to to pass to calls on the targets.
    /// @param description A non-empty string that describes the proposal.
    function propose(address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas, string memory description) public returns (uint) {
        require(_getVotingPower(msg.sender, block.number - 1) > proposalThreshold, "GovernorApollo::propose: proposer votes below proposal threshold");
        require(targets.length == values.length && targets.length == signatures.length && targets.length == calldatas.length, "GovernorApollo::propose: proposal function information arity mismatch");
        require(targets.length != 0, "GovernorApollo::propose: must provide actions");
        require(targets.length <= proposalMaxOperations, "GovernorApollo::propose: too many actions");
        require(bytes(description).length > 0, "description can not be empty");

        uint latestProposalId = latestProposalIds[msg.sender];
        if (latestProposalId != 0) {
          ProposalState proposersLatestProposalState = state(latestProposalId);
          require(proposersLatestProposalState != ProposalState.Active, "GovernorApollo::propose: one live proposal per proposer, found an already active proposal");
          require(proposersLatestProposalState != ProposalState.Pending, "GovernorApollo::propose: one live proposal per proposer, found an already pending proposal");
        }

        uint startTimestamp = block.timestamp + votingDelay;
        uint endTimestamp = block.timestamp + votingPeriod + votingDelay;

        // Increment proposal count. This is important to do before quorum is adjusted, so that the for loop will
        // execute.
        ++proposalCount;
        
        // Adjust quorum.
        _adjustQuorum();

        Proposal storage newProposal = proposals[proposalCount];
        newProposal.id = proposalCount;
        newProposal.proposer = msg.sender;
        newProposal.targets = targets;
        newProposal.values = values;
        newProposal.signatures = signatures;
        newProposal.calldatas = calldatas;
        newProposal.startTimestamp = startTimestamp;
        newProposal.endTimestamp = endTimestamp;
        newProposal.quorum = currentQuorum;

        latestProposalIds[newProposal.proposer] = proposalCount;

        emit ProposalCreated(newProposal.id, msg.sender, targets, values, signatures, calldatas, startTimestamp, endTimestamp, description, currentQuorum);
        return newProposal.id;
    }

    /// @notice Gets the quorum value for a new proposal.
    /// @return newQuorum The quorum value that will be assigned to a new proposal.
    function getQuorum() external view returns (uint) {
        uint newQuorum = currentQuorum;

        // Start at the high water mark
        for (uint i = lastQuorumAdjustment + 1; i < proposalCount; ++i) {
            // Pull state and ignore in flight proposals
            ProposalState proposalState = state(i);
            if (proposalState == ProposalState.Pending || proposalState == ProposalState.Active) {
                continue;
            }

            // Get the proposal
            Proposal storage proposal = proposals[i];

            // Only proceed if quorum for this proposal is not yet taken into account.
            if (!proposal.quorumAdjusted) {
                // If a proposal is canceled, ignore it in quorum calculations.
                if (proposalState == ProposalState.Canceled) {
                    continue;
                }

                // Adjust quorum in accordance with the proposal.
                newQuorum = _calculateNewQuorum(newQuorum, proposal.totalVotes);
            }
        }

        return newQuorum;
    }

    /// @notice Queues a succeeded proposal in the timelock for execution.
    /// @param proposalId The ID of the succeeded proposal to queue.
    function queue(uint proposalId) external {
        require(state(proposalId) == ProposalState.Succeeded, "GovernorApollo::queue: proposal can only be queued if it is succeeded");
        Proposal storage proposal = proposals[proposalId];
        uint eta = block.timestamp + timelock.delay();
        for (uint i = 0; i < proposal.targets.length; ++i) {
            _queueOrRevert(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i], eta);
        }
        proposal.eta = eta;
        emit ProposalQueued(proposalId, eta);
    }

    /// @notice Queues a single action in a proposal for execution.
    /// @param target The target address.
    /// @param value The amount of native asset to pass with the call.
    /// @param signature The function signature to call on the target. 
    /// @param data The calldata to pass to function calls on the target.
    /// @param eta A timestamp of when the action may be executed.
    function _queueOrRevert(address target, uint value, string memory signature, bytes memory data, uint eta) internal {
        require(!timelock.queuedTransactions(keccak256(abi.encode(target, value, signature, data, eta))), "GovernorApollo::_queueOrRevert: proposal action already queued at eta");
        timelock.queueTransaction(target, value, signature, data, eta);
    }

    /// @notice Execute a queued proposal from the timelock after the timelock delay has been passed.
    /// @param proposalId The ID of the queued proposal to execute.
    function execute(uint proposalId) external {
        require(state(proposalId) == ProposalState.Queued, "GovernorApollo::execute: proposal can only be executed if it is queued");
        Proposal storage proposal = proposals[proposalId];
        proposal.executed = true;
        for (uint i = 0; i < proposal.targets.length; ++i) {
            timelock.executeTransaction(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i], proposal.eta);
        }
        emit ProposalExecuted(proposalId);
    }

    /// @notice Cancel a proposal that is in flight.
    /// @param proposalId The ID of the proposal ot cancel.
    function cancel(uint proposalId) external {
        ProposalState proposalState = state(proposalId);
        require(proposalState != ProposalState.Executed, "GovernorApollo::cancel: cannot cancel executed proposal");

        Proposal storage proposal = proposals[proposalId];
        require(_getVotingPower(proposal.proposer, block.number - 1) < proposalThreshold, "GovernorApollo::cancel: proposer above threshold");

        proposal.canceled = true;
        for (uint i = 0; i < proposal.targets.length; ++i) {
            timelock.cancelTransaction(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i], proposal.eta);
        }

        emit ProposalCanceled(proposalId);
    }

    /// @notice Get a list of actions in a proposal.
    /// @param proposalId The ID of the proposal to inspect.
    /// @return targets Targets in the proposal.
    /// @return values Values in the proposal.
    /// @return signatures Signatures in the proposal.
    /// @return calldatas Calldatas in the proposal.
    function getActions(uint proposalId) external view returns (address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas) {
        Proposal storage p = proposals[proposalId];
        return (p.targets, p.values, p.signatures, p.calldatas);
    }

    /// @notice Get a receipt for a voter for the given proposal.
    /// @param proposalId The ID of the desired proposal.
    /// @param voter The address of the desired voter.
    /// @return A receipt for the voter if one exists.
    function getReceipt(uint proposalId, address voter) external view returns (Receipt memory) {
        return proposals[proposalId].receipts[voter];
    }

    /// @notice Get the state of a proposal.
    /// @param proposalId The ID of the desired proposal.
    /// @return The state of the given proposal.
    function state(uint proposalId) public view returns (ProposalState) {
        require(proposalCount >= proposalId && proposalId > 0, "GovernorApollo::state: invalid proposal id");
        Proposal storage proposal = proposals[proposalId];

        // First check if the proposal cancelled.
        if (proposal.canceled) {
            return ProposalState.Canceled;
        // Then check if the proposal is pending or active, in which case nothing else can be determined at this time.
        } else if (block.timestamp <= proposal.startTimestamp) {
            return ProposalState.Pending;
        } else if (block.timestamp <= proposal.endTimestamp) {
            return ProposalState.Active;
        // Then, check if the proposal is defeated. To hit this case, either (1) majority of yay/nay votes were nay or 
        // (2) total votes was less than the quorum amount.
        } else if (proposal.forVotes <= proposal.againstVotes || proposal.totalVotes < proposal.quorum) {
            return ProposalState.Defeated;
        } else if (proposal.eta == 0) {
            return ProposalState.Succeeded;
        } else if (proposal.executed) {
            return ProposalState.Executed;
        } else if (block.timestamp >= proposal.eta + timelock.GRACE_PERIOD()) {
            return ProposalState.Expired;
        } else {
            return ProposalState.Queued;
        }
    }

    /// @notice Cast a vote for the given proposal with the given value. 
    /// @param proposalId The ID of proposal to cast a vote on.
    /// @param voteValue A constant representing 'yay', 'nay', or 'abstain'.
    function castVote(uint proposalId, uint8 voteValue) external {
        return _castVote(msg.sender, proposalId, voteValue);
    }

    /// @notice Cast a vote for the given proposal with an EIP 712 signature.
    /// @param proposalId The ID of proposal to cast a vote on.
    /// @param voteValue A constant representing 'yay', 'nay', or 'abstain'.
    /// @param v The 'v' value of the signature.
    /// @param r The 'r' value of the signature.
    /// @param s The 's' value of the signature.
    function castVoteBySig(uint256 proposalId, uint8 voteValue, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), getChainId(), address(this)));
        bytes32 structHash = keccak256(abi.encode(BALLOT_TYPEHASH, proposalId, voteValue));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));    
        address signatory = ecrecover(digest, v, r, s);
        require(signatory != address(0), "GovernorApollo::castVoteBySig: invalid signature");
        return _castVote(signatory, proposalId, voteValue);
    }

    /// @notice Internal function to cast a vote.
    /// @param voter The address who is casting a vote. 
    /// @param proposalId The ID of the proposal a vote is being cast on.
    /// @param voteValue A constant representing 'yay', 'nay', or 'abstain'.
    function _castVote(address voter, uint proposalId, uint8 voteValue) internal {
        require(state(proposalId) == ProposalState.Active, "GovernorApollo::_castVote: voting is closed");
        Proposal storage proposal = proposals[proposalId];
        if (proposal.startBlock == 0) {
            proposal.startBlock = block.number - 1;
            emit StartBlockSet(proposalId, block.number);
        }
        Receipt storage receipt = proposal.receipts[voter];
        require(receipt.hasVoted == false, "GovernorApollo::_castVote: voter already voted");
        uint votes = _getVotingPower(voter, proposal.startBlock);

        if (voteValue == voteValueYes) {
            proposal.forVotes = proposal.forVotes + votes;
        } else if (voteValue == voteValueNo) {
            proposal.againstVotes = proposal.againstVotes + votes;
        } else if (voteValue == voteValueAbstain) {
            proposal.abstainVotes = proposal.abstainVotes + votes;
        } else {
            // Catch all. If an above case isn't matched then the value is not valid.
            revert("GovernorApollo::_castVote: invalid vote value");
        }

        // Increase total votes
        proposal.totalVotes = proposal.totalVotes + votes; 

        receipt.hasVoted = true;
        receipt.voteValue = voteValue;
        receipt.votes = votes;

        emit VoteCast(voter, proposalId, voteValue, votes);
    }

    /// @notice Get the given voter's voting power at the given block number.
    /// @param voter The voter to inspect. 
    /// @param blockNumber The block number to get voting power at.
    /// @return The voter's voting power at the given block number.
    function _getVotingPower(address voter, uint blockNumber) internal view returns (uint) {
        // Get votes from the WELL contract, the distributor contract, and the safety module contact.
        uint96 govTokenVotes = govToken.getPriorVotes(voter, blockNumber);
        uint distibutorVotes = distributor.getPriorVotes(voter, blockNumber);
        uint safetyModuleVotes = safetyModule.getPriorVotes(voter, blockNumber);

        return uint(govTokenVotes) + distibutorVotes + safetyModuleVotes;
    }

    /// @notice Searches proposals that have settled in order to adjust the floating quorum.
    function _adjustQuorum() internal {
        uint newQuorum = currentQuorum;
        uint newHighWaterMark = lastQuorumAdjustment;

        // Start at the high water mark
        for (uint i = lastQuorumAdjustment + 1; i < proposalCount; ++i) {
            // Pull state and ignore in flight proposals
            ProposalState proposalState = state(i);
            if (proposalState == ProposalState.Pending || proposalState == ProposalState.Active) {
                continue;
            }

            // Get the proposal
            Proposal storage proposal = proposals[i];

            // If this proposal is sequential to the old high water mark, adjust the high water mark.
            if (proposal.id == newHighWaterMark + 1) {
                newHighWaterMark = proposal.id;
            }

            // Only proceed if quorum for this proposal is not yet taken into account.
            if (!proposal.quorumAdjusted) {
                // Mark it as adjusted, and update the high water mark.
                proposal.quorumAdjusted = true;

                // If a proposal is canceled, ignore it in quorum calculations.
                if (proposalState == ProposalState.Canceled) {
                    continue;
                }

                // Adjust quorum in accordance with the proposal.
                newQuorum = _calculateNewQuorum(newQuorum, proposal.totalVotes);
            }
        }

        // Emit an event if quorum was adjusted
        if (newQuorum != currentQuorum) {
            emit QuroumVotesChanged(currentQuorum, newQuorum);
        }

        // Save back to storage from memory
        currentQuorum = newQuorum;
        lastQuorumAdjustment = newHighWaterMark;
    }

    /// @notice Calculates a new quorum value by weighting the old quorum value and a new proposal's quorum value. The
    ///         newly calculated value is bounded to the quorum caps. 
    /// @param oldQuorum The value of quorum before this adjustment is made.
    /// @param newAmount The amount of votes on a proposal that is used to adjust quorum.
    /// @return An adjusted quorum value.
    function _calculateNewQuorum(uint oldQuorum, uint newAmount) internal view returns (uint) {
        // Weight new quorum as 80% of old quorum and 20% of new quorum.
        uint oldQuorumWeight = (oldQuorum * 80) / 100;
        uint newQuorumWeight = (newAmount * 20) / 100;
        uint newQuorum = oldQuorumWeight + newQuorumWeight;

        // Bound on caps;
        if (newQuorum > upperQuorumCap) {
            return upperQuorumCap;
        }
        if (newQuorum < lowerQuorumCap) {
            return lowerQuorumCap;
        }
        return newQuorum;
    }

    /// @notice Sweeps all tokens owned by Governor alpha to the given destination address.
    /// @param tokenAddress The address of the token to move.
    /// @param destinationAddress The address to move tokens to.
    function sweepTokens(address tokenAddress, address destinationAddress) external {
        require(msg.sender == address(timelock), "GovernorApollo::sweepTokens: sender must be timelock");

        IERC20 token = IERC20(tokenAddress);
        uint balance = token.balanceOf(address(this));

        token.transfer(destinationAddress, balance);
    }

    /// Governance Introspection

    /// @notice Sets quorum caps for the governor. Only allowed to be changed via a governance proposal.
    /// @dev This call will revert if called by anyone other than the timelock, which prevents anyone other than a
    ///      governance proposal from adjusting the parameters.
    /// @param newLowerQuorumCap The new lower quorum cap.
    /// @param newUpperQuorumCap The new upper quorum cap.
    function setQuorumCaps(uint newLowerQuorumCap, uint newUpperQuorumCap) external {
        require(msg.sender == address(timelock), "only timelock");
        require(newUpperQuorumCap > newLowerQuorumCap, "bad cap ordering");

        if (newLowerQuorumCap != lowerQuorumCap) {
            uint oldLowerQuorumCap = lowerQuorumCap;
            lowerQuorumCap = newLowerQuorumCap;
            emit LowerQuorumCapChanged(oldLowerQuorumCap, newLowerQuorumCap);
        }

        if (newUpperQuorumCap != upperQuorumCap) {
            uint oldUpperQuorumCap = upperQuorumCap;
            upperQuorumCap = newUpperQuorumCap;
            emit UpperQuorumCapChanged(oldUpperQuorumCap, newUpperQuorumCap);
        }
    }

    /// @notice Sets a proposal threshold for the governor. Only allowed to be changed via a governance proposal.
    /// @dev This call will revert if called by anyone other than the timelock, which prevents anyone other than a
    ///      governance proposal from adjusting the parameters.
    /// @param newValue The new proposal threshold.
    function setProposalThreshold(uint newValue) external {
        require(msg.sender == address(timelock), "only timelock");

        uint256 oldValue = proposalThreshold;

        proposalThreshold = newValue;      
        emit ProposalThresholdChanged(oldValue, newValue);  
    }

    /// @notice Sets a voting delay for the governor. Only allowed to be changed via a governance proposal.
    /// @dev This call will revert if called by anyone other than the timelock, which prevents anyone other than a
    ///      governance proposal from adjusting the parameters.
    /// @param newValue The new voting delay in seconds.
    function setVotingDelay(uint newValue) external {
        require(msg.sender == address(timelock), "only timelock");

        uint256 oldValue = votingDelay;

        votingDelay = newValue;        
        emit VotingDelayChanged(oldValue, newValue);
    }

    /// @notice Sets the max operations in a proposal for the governor. Only allowed to be changed via a governance 
    ///         proposal.
    /// @dev This call will revert if called by anyone other than the timelock, which prevents anyone other than a
    ///      governance proposal from adjusting the parameters.
    /// @param newValue The new max operations.
    function setProposalMaxOperations(uint newValue) external {
        require(msg.sender == address(timelock), "only timelock");

        uint256 oldValue = proposalMaxOperations;

        proposalMaxOperations = newValue;
        emit ProposalMaxOperationsChanged(oldValue, newValue);
    }

    /// @notice Sets a period delay for the governor. Only allowed to be changed via a governance proposal.
    /// @dev This call will revert if called by anyone other than the timelock, which prevents anyone other than a
    ///      governance proposal from adjusting the parameters.
    /// @param newValue The new voting period in seconds.
    function setVotingPeriod(uint newValue) external {
        require(msg.sender == address(timelock), "only timelock");

        uint256 oldValue = votingPeriod;

        votingPeriod = newValue;                
        emit VotingPeriodChanged(oldValue, newValue);
    }

    /// @notice Sets a new break glass guardian for the governor. Only allowed to be changed via a governance proposal.
    /// @dev This call will revert if called by anyone other than the timelock, which prevents anyone other than a
    ///      governance proposal from adjusting the parameters.
    /// @param newGuardian The address of the new break grlass guardian.
    function setBreakGlassGuardian(address newGuardian) external {
        require(msg.sender == breakGlassGuardian, "only break glass guardian");

        address oldValue = breakGlassGuardian;

        breakGlassGuardian = newGuardian;
        emit BreakGlassGuardianChanged(oldValue, newGuardian);
    }    

    /// Governance Return Guardian

    /// @notice Sets the address that governance will be returned to in an emergency. Only callable by the governance return guardian.
    /// @param governanceReturnAddress_ The new governance return address.
    function __setGovernanceReturnAddress(address governanceReturnAddress_) external {
        require(msg.sender == governanceReturnGuardian, "GovernorApollo::__setGovernanceReturnAddress: sender must be gov return guardian");

        address oldValue = governanceReturnAddress;

        governanceReturnAddress = governanceReturnAddress_;

        emit GovernanceReturnAddressChanged(oldValue, governanceReturnAddress_);
    }

    /// Break Glass Guardian - Emergency Declarations

    /// @notice Fast tracks calling _setPendingAdmin on the given contracts through the timelock. Only callable by the break glass guardian.
    /// @param addresses The addresses to call on.
    function __executeBreakGlassOnCompound(CompoundSetPendingAdminInterface[] calldata addresses) external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__breakglass: sender must be bg guardian");

        uint length = addresses.length;
        for (uint i = 0; i < length; ++i) {     
            timelock.fastTrackExecuteTransaction(address(addresses[i]), 0, "_setPendingAdmin(address)", abi.encode(governanceReturnAddress));
        }
    }

    /// @notice Fast tracks calling setAdmin on the given contracts through the timelock. Only callable by the break glass guardian.
    /// @param addresses The addresses to call on.
    function __executeBreakGlassOnSetAdmin(SetAdminInterface[] calldata addresses) external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__breakglass: sender must be bg guardian");

        uint length = addresses.length;
        for (uint i = 0; i < length; ++i) {     
            timelock.fastTrackExecuteTransaction(address(addresses[i]), 0, "setAdmin(address)", abi.encode(governanceReturnAddress));
        }
    }

    /// @notice Fast tracks calling setPendingAdmin on the given contracts through the timelock. Only callable by the break glass guardian.
    /// @param addresses The addresses to call on.
    function __executeBreakGlassOnSetPendingAdmin(SetPendingAdminInterface[] calldata addresses) external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__breakglass: sender must be bg guardian");

        uint length = addresses.length;
        for (uint i = 0; i < length; ++i) {     
            timelock.fastTrackExecuteTransaction(address(addresses[i]), 0, "setPendingAdmin(address)", abi.encode(governanceReturnAddress));
        }
    }    

    /// @notice Fast tracks calling changeAdmin on the given contracts through the timelock. Only callable by the break glass guardian.
    /// @param addresses The addresses to call on.
    function __executeBreakGlassOnChangeAdmin(ChangeAdminInterface[] calldata addresses) external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__breakglass: sender must be bg guardian");

        uint length = addresses.length;
        for (uint i = 0; i < length; ++i) {     
            timelock.fastTrackExecuteTransaction(address(addresses[i]), 0, "changeAdmin(address)", abi.encode(governanceReturnAddress));
        }
    }    

    /// @notice Fast tracks calling transferOwnership on the given contracts through the timelock. Only callable by the break glass guardian.
    /// @param addresses The addresses to call on.
    function __executeBreakGlassOnOwnable(OwnableInterface[] calldata addresses) external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__breakglass: sender must be bg guardian");

        uint length = addresses.length;
        for (uint i = 0; i < length; ++i) {     
            timelock.fastTrackExecuteTransaction(address(addresses[i]), 0, "transferOwnership(address)", abi.encode(governanceReturnAddress));
        }
    }

    /// @notice Fast tracks setting an emissions manager on the given contracts through the timelock. Only callable by the break glass guardian.
    /// @param addresses The addresses to call on.
    function __executeBreakGlassOnEmissionsManager(SetEmissionsManagerInterface[] calldata addresses) external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__breakglass: sender must be bg guardian");

        uint length = addresses.length;
        for (uint i = 0; i < length; ++i) {     
            timelock.fastTrackExecuteTransaction(address(addresses[i]), 0, "setEmissionsManager(address)", abi.encode(governanceReturnAddress));
        }        
    }

    /// Break Glass Guardian - Recovery Operations

    /// @notice Fast tracks calling _acceptAdmin through the timelock for the given targets.
    /// @param addresses The addresses to call on.
    function __executeCompoundAcceptAdminOnContract(address[] calldata addresses) external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__executeCompoundAcceptAdminOnContract: sender must be bg guardian");

        uint length = addresses.length;
        for (uint i = 0; i < length; ++i) {  
            timelock.fastTrackExecuteTransaction(addresses[i], 0, "_acceptAdmin()", abi.encode());
        }
    }

    /// @notice Fast tracks calling acceptPendingAdmin through the timelock for the given targets.
    /// @param addresses The addresses to call on.
    function __executeAcceptAdminOnContract(address[] calldata addresses) external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__executeAcceptAdminOnContract: sender must be bg guardian");

        uint length = addresses.length;
        for (uint i = 0; i < length; ++i) {  
            timelock.fastTrackExecuteTransaction(addresses[i], 0, "acceptPendingAdmin()", abi.encode());
        }
    }

    /// Break Glass Guardian - Timelock Management

    /// @notice Calls accept admin on the timelock. Only callable by the break glass guardian.
    function __acceptAdminOnTimelock() external {
        require(msg.sender == breakGlassGuardian, "GovernorApollo::__acceptAdmin: sender must be bg guardian");
        timelock.acceptAdmin();
    }

    /// Guardian Removeal

    /// @notice Removes Guardians from the governance process. Can only be called by the timelock. This is an irreversible operation.
    function __removeGuardians() external {
        // Removing power can only come via a governance vote, which will be executed from the timelock.
        require(msg.sender == address(timelock), "GovernorApollo::__removeGuardians: sender must be the timelock");

        // Removing the governance guardian can only occur after the sunset.
        require(block.timestamp >= guardianSunset, "GovernorApollo::__removeGuardians cannot remove before sunset");

        // Set both guardians to the zero address.
        breakGlassGuardian = address(0);
        governanceReturnGuardian = address(0);
    }

    /// @notice Get the chain ID this contract is deployed on.
    /// @return The chain ID.
    function getChainId() internal view returns (uint) {
        uint chainId;
        assembly { chainId := chainid() }
        return chainId;
    }
}

interface TimelockInterface {
    function delay() external view returns (uint);
    function GRACE_PERIOD() external view returns (uint);
    function acceptAdmin() external;
    function queuedTransactions(bytes32 hash) external view returns (bool);
    function queueTransaction(address target, uint value, string calldata signature, bytes calldata data, uint eta) external returns (bytes32);
    function cancelTransaction(address target, uint value, string calldata signature, bytes calldata data, uint eta) external;
    function executeTransaction(address target, uint value, string calldata signature, bytes calldata data, uint eta) external payable returns (bytes memory);
    function fastTrackExecuteTransaction(address target, uint value, string calldata signature, bytes calldata data) external payable returns (bytes memory);
}

interface GovTokenInterface {
    function getPriorVotes(address account, uint blockNumber) external view returns (uint96);
}

interface SnapshotInterface {
    function getPriorVotes(address account, uint blockNumber) external view returns (uint256);
}

// Used on Compound Contracts - Unitroller, MTokens
interface CompoundSetPendingAdminInterface {
    function _setPendingAdmin(address newPendingAdmin) external;
}

// Used on Chainlink Oracle
interface SetAdminInterface {
    function setAdmin(address newAdmin) external;
}

// Used on TokenSaleDistributor
interface SetPendingAdminInterface {
    function setPendingAdmin(address newAdmin) external;
}

// Used on safety ProxyAdmin
interface SetEmissionsManagerInterface {
    function setEmissionsManager(address newEmissionsManager) external;
}

// Used on safety module ProxyAdmin
interface ChangeAdminInterface {
    function changeAdmin(address newAdmin) external;
}

// Used on Ownable contracts - EcoystemReserveController
interface OwnableInterface {
    function transferOwnership(address newOwner) external;
}
