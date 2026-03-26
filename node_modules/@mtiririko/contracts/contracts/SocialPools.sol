// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SocialPools
 * @dev Codifies Kenyan Social Finance: Harambees (kickstarter-escrow) and Chamas (rotating group savings).
 */
contract SocialPools is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public stablecoin;

    // --- Harambee (Crowdfunding) ---
    struct Harambee {
        address organizer;
        uint256 targetAmount;
        uint256 currentAmount;
        uint256 expiry;
        bool claimed;
        mapping(address => uint256) contributors;
    }

    uint256 public harambeeCount;
    mapping(uint256 => Harambee) public harambees;

    event HarambeeCreated(uint256 indexed id, address indexed organizer, uint256 targetAmount, uint256 expiry);
    event HarambeeFunded(uint256 indexed id, address indexed contributor, uint256 amount);
    event HarambeeClaimed(uint256 indexed id, uint256 amount);
    event HarambeeRefunded(uint256 indexed id, address indexed contributor, uint256 amount);

    constructor(address _stablecoinAddress) {
        stablecoin = IERC20(_stablecoinAddress);
    }

    function createHarambee(uint256 targetAmount, uint256 durationInDays) external returns (uint256) {
        require(targetAmount > 0, "Target must be > 0");
        require(durationInDays > 0, "Duration must be > 0");

        uint256 id = harambeeCount++;
        Harambee storage h = harambees[id];
        h.organizer = msg.sender;
        h.targetAmount = targetAmount;
        h.expiry = block.timestamp + (durationInDays * 1 days);

        emit HarambeeCreated(id, msg.sender, targetAmount, h.expiry);
        return id;
    }

    function fundHarambee(uint256 id, uint256 amount) external nonReentrant {
        Harambee storage h = harambees[id];
        require(h.organizer != address(0), "Harambee does not exist");
        require(block.timestamp <= h.expiry, "Harambee expired");
        require(!h.claimed, "Harambee already finalized");

        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        h.contributors[msg.sender] += amount;
        h.currentAmount += amount;

        emit HarambeeFunded(id, msg.sender, amount);
    }

    function claimHarambee(uint256 id) external nonReentrant {
        Harambee storage h = harambees[id];
        require(msg.sender == h.organizer, "Only organizer can claim");
        require(h.currentAmount >= h.targetAmount, "Target not yet reached");
        require(!h.claimed, "Already claimed");

        h.claimed = true;
        stablecoin.safeTransfer(h.organizer, h.currentAmount);

        emit HarambeeClaimed(id, h.currentAmount);
    }

    function refundHarambee(uint256 id) external nonReentrant {
        Harambee storage h = harambees[id];
        require(block.timestamp > h.expiry, "Harambee not yet expired");
        require(h.currentAmount < h.targetAmount, "Target was reached, cannot refund");
        
        uint256 contribution = h.contributors[msg.sender];
        require(contribution > 0, "Nothing to refund");

        h.contributors[msg.sender] = 0; // Prevent re-entrancy
        stablecoin.safeTransfer(msg.sender, contribution);

        emit HarambeeRefunded(id, msg.sender, contribution);
    }
}
