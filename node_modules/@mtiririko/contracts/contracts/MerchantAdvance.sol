// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Abstract interface to the L1 Batch Settlement
interface IBatchSettlement {
    function submitAdvanceClaim(address originalRecipient, address lpFunder, uint256 split) external;
}

/**
 * @title MerchantAdvance
 * @dev Decentralized Liquidity Pool solving the "Time Value of Money" for local businesses.
 * LPs deposit cKES. Merchants sell pending L2 intents to the pool at a 1% discount to get instant liquidity.
 */
contract MerchantAdvance is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public stablecoin;
    
    // Pool State
    uint256 public totalLiquidity;
    mapping(address => uint256) public lpBalances;

    // Fixed Yield Spread: 100 = 1% Instant Discount paid to LPs
    uint256 public constant SPREAD_BPS = 100;

    event LiquidityAdded(address indexed lp, uint256 amount);
    event LiquidityRemoved(address indexed lp, uint256 amount);
    event IntentPurchased(address indexed merchant, uint256 intentAmount, uint256 advancePaid);

    constructor(address _stablecoinAddress) {
        stablecoin = IERC20(_stablecoinAddress);
    }

    /**
     * @dev Liquidity Providers deposit cKES to generate yield from Merchant spreads.
     */
    function provideLiquidity(uint256 amount) external nonReentrant {
        require(amount > 0, "Must deposit > 0");
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        lpBalances[msg.sender] += amount;
        totalLiquidity += amount;

        emit LiquidityAdded(msg.sender, amount);
    }

    /**
     * @dev LPs withdraw their capital plus accrued spread yields.
     */
    function removeLiquidity(uint256 amount) external nonReentrant {
        require(lpBalances[msg.sender] >= amount, "Insufficient LP balance");
        lpBalances[msg.sender] -= amount;
        totalLiquidity -= amount;
        stablecoin.safeTransfer(msg.sender, amount);

        emit LiquidityRemoved(msg.sender, amount);
    }

    /**
     * @dev Used when the off-chain system pairs a Merchant's pending intent with the Pool.
     * The pool pays out (IntentAmount * 0.99) instantly to the merchant.
     * The L2 Intent's destination address is mathematically overridden off-chain to point the final L1 settlement back into this pool.
     */
    function purchaseMerchantIntent(address merchant, uint256 intentAmount) external nonReentrant {
        uint256 spread = (intentAmount * SPREAD_BPS) / 10000;
        uint256 advanceAmount = intentAmount - spread;

        require(totalLiquidity >= advanceAmount, "Insufficient pool liquidity for advance");

        // Temporarily reduce available pool capital until the L2 batch settles the raw intent
        totalLiquidity -= advanceAmount;
        
        // Advance the discounted cash instantly to the merchant
        stablecoin.safeTransfer(merchant, advanceAmount);

        emit IntentPurchased(merchant, intentAmount, advanceAmount);
    }

    /**
     * @dev When the BatchSettlement contract finally lands on L1, the funds routed to the pool
     * are injected back into totalLiquidity, compounding the LPs' initial stake.
     */
    function reinvestSettledIntent(uint256 settledAmount) external nonReentrant {
        // Technically anyone can call this as long as they are bringing funds IN.
        // Usually called via `stablecoin.approve()` -> `transferFrom` triggered by the Relayer network processing the batch.
        stablecoin.safeTransferFrom(msg.sender, address(this), settledAmount);
        totalLiquidity += settledAmount;

        // Note: In a production Yield pool, LP shares (ERC-4626) would cleanly divide the accrued `settledAmount` pro-rata.
    }
}
