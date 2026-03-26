// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ConditionalPayments
 * @dev Autonomous Programmable Money. Users escrow funds locked to a specific condition hash.
 * A designated oracle (e.g. Weather API, Gig Platform) signs off on the condition to release the funds.
 */
contract ConditionalPayments is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public stablecoin;

    struct PaymentRule {
        address sender;
        address recipient;
        uint256 amount;
        address oracle; // The entity authorized to trigger the payment
        bytes32 conditionHash; // Hash of the exact condition (e.g., "NAIROBI_RAIN_>_50MM", "TASK_123_COMPLETE")
        uint256 expiry;
        bool executed;
    }

    // ruleId => PaymentRule
    mapping(bytes32 => PaymentRule) public rules;

    event RuleCreated(bytes32 indexed ruleId, address indexed sender, address recipient, uint256 amount, bytes32 conditionHash, uint256 expiry);
    event RuleExecuted(bytes32 indexed ruleId, bytes32 conditionHash);
    event RuleRefunded(bytes32 indexed ruleId);

    constructor(address _stablecoinAddress) {
        stablecoin = IERC20(_stablecoinAddress);
    }

    /**
     * @dev Create a programmable money rule. Locks the sender's funds into escrow.
     */
    function createMoneyRule(
        bytes32 ruleId,
        address recipient,
        uint256 amount,
        address oracle,
        bytes32 conditionHash,
        uint256 expiry
    ) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(expiry > block.timestamp, "Expiry must be in the future");
        require(rules[ruleId].sender == address(0), "Rule ID already exists");

        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        rules[ruleId] = PaymentRule({
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            oracle: oracle,
            conditionHash: conditionHash,
            expiry: expiry,
            executed: false
        });

        emit RuleCreated(ruleId, msg.sender, recipient, amount, conditionHash, expiry);
    }

    /**
     * @dev Execute the rule. Requires exactly the predefined oracle to sign the predefined conditionHash.
     * @param oracleSignature Signature from the oracle confirming the condition is met.
     */
    function executeRule(bytes32 ruleId, bytes calldata oracleSignature) external nonReentrant {
        PaymentRule storage rule = rules[ruleId];
        require(rule.sender != address(0), "Rule does not exist");
        require(!rule.executed, "Rule already executed");
        require(block.timestamp <= rule.expiry, "Rule expired");

        // The oracle signs the specific condition piece of data to prevent replay across different rules
        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(ruleId, rule.conditionHash)));
        address recoveredSigner = ECDSA.recover(messageHash, oracleSignature);
        
        require(recoveredSigner == rule.oracle, "Invalid Oracle Signature");

        rule.executed = true;
        stablecoin.safeTransfer(rule.recipient, rule.amount);

        emit RuleExecuted(ruleId, rule.conditionHash);
    }

    /**
     * @dev If the condition is never met by the expiry time, allow the sender to reclaim funds.
     */
    function refundExpiredRule(bytes32 ruleId) external nonReentrant {
        PaymentRule storage rule = rules[ruleId];
        require(rule.sender != address(0), "Rule does not exist");
        require(!rule.executed, "Rule already executed");
        require(block.timestamp > rule.expiry, "Rule has not yet expired");

        rule.executed = true; // Mark as resolved to prevent re-entrancy/double refund
        stablecoin.safeTransfer(rule.sender, rule.amount);

        emit RuleRefunded(ruleId);
    }
}
