// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PaymentChannels
 * @dev Enables KES 1 micro-transactions by locking funds on-chain and exchanging 
 * high-frequency off-chain signatures. Only the final net balance is settled on-chain.
 */
contract PaymentChannels is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public stablecoin;

    struct Channel {
        address sender;
        address recipient;
        uint256 depositAmount;
        uint256 expiry;
        bool closed;
    }

    mapping(bytes32 => Channel) public channels;
    mapping(bytes32 => uint256) public closedNonces; // Tracks the final nonce to prevent replay attacks

    event ChannelOpened(bytes32 indexed channelId, address indexed sender, address indexed recipient, uint256 amount, uint256 expiry);
    event ChannelClosed(bytes32 indexed channelId, uint256 recipientAmount, uint256 refundAmount);
    event ChannelExpiredAndRefunded(bytes32 indexed channelId);

    constructor(address _stablecoinAddress) {
        stablecoin = IERC20(_stablecoinAddress);
    }

    /**
     * @dev Opens a unidirectional payment channel, locking the sender's funds.
     */
    function openChannel(bytes32 channelId, address recipient, uint256 amount, uint256 expiry) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(expiry > block.timestamp, "Expiry must be in the future");
        require(channels[channelId].sender == address(0), "Channel already exists");

        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        channels[channelId] = Channel({
            sender: msg.sender,
            recipient: recipient,
            depositAmount: amount,
            expiry: expiry,
            closed: false
        });

        emit ChannelOpened(channelId, msg.sender, recipient, amount, expiry);
    }

    /**
     * @dev Closes a channel using the latest off-chain signature provided by the sender.
     * Anyone can submit the signature, but typically the recipient submits the highest value they possess.
     */
    function closeChannel(
        bytes32 channelId, 
        uint256 recipientAmount, 
        bytes calldata senderSignature
    ) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(channel.sender != address(0), "Channel does not exist");
        require(!channel.closed, "Channel already closed");
        require(recipientAmount <= channel.depositAmount, "Recipient amount exceeds deposit");

        // Validate the signature proves the sender authorized this final recipient balance
        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(channelId, recipientAmount)));
        address recoveredSigner = ECDSA.recover(messageHash, senderSignature);
        
        require(recoveredSigner == channel.sender, "Invalid Sender Signature");

        channel.closed = true;

        uint256 refundAmount = channel.depositAmount - recipientAmount;

        // Distribute funds
        if (recipientAmount > 0) {
            stablecoin.safeTransfer(channel.recipient, recipientAmount);
        }
        if (refundAmount > 0) {
            stablecoin.safeTransfer(channel.sender, refundAmount);
        }

        emit ChannelClosed(channelId, recipientAmount, refundAmount);
    }

    /**
     * @dev Recovers funds if the recipient goes silent and the channel expires.
     */
    function expireChannel(bytes32 channelId) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(channel.sender != address(0), "Channel does not exist");
        require(!channel.closed, "Channel already closed");
        require(block.timestamp > channel.expiry, "Channel not yet expired");

        channel.closed = true;
        stablecoin.safeTransfer(channel.sender, channel.depositAmount);

        emit ChannelExpiredAndRefunded(channelId);
    }
}
