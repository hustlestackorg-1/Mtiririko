// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IcKES is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function verifiedReserveAmount() external view returns (uint256);
}

/**
 * @title LiquidityRouter
 * @dev Bridges external liquidity (e.g., USDC, USDT, Bank Rails equivalents) into the Mtiririko cKES ecosystem.
 */
contract LiquidityRouter is Initializable, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuard, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    IcKES public cKES;

    // Mapping of authorized external tokens to their exchange rate (relative to cKES). 
    // Rate format: 1 Token = X cKES. (Scaled by 1e18)
    mapping(address => uint256) public tokenRates;
    mapping(address => bool) public supportedTokens;

    // --- Enterprise Bridge Safeguards ---
    uint256 public constant RATE_LIMIT_WINDOW = 1 days;

    struct TokenSafeguards {
        uint256 dailyOutflowLimit;     // Max cKES equivalent outflow per 24hr
        uint256 currentDailyOutflow;   // Current accrued outflow in window
        uint256 windowStartTimestamp;  // Timestamp the current 24h window began
        uint256 totalMinted;           // Strict Collateral Isolation (cannot withdraw > minted)
        bool isCircuitBreakerTripped;  // Per-token death switch
    }
    mapping(address => TokenSafeguards) public safeguards;

    event LiquidityBridgedIn(address indexed user, address indexed token, uint256 tokenAmount, uint256 cKESAmount);
    event LiquidityBridgedOut(address indexed user, address indexed token, uint256 cKESAmount, uint256 tokenAmount);
    event TokenSupported(address indexed token, uint256 rate, uint256 dailyLimit);
    event TokenUnsupported(address indexed token);
    event CircuitBreakerTripped(address indexed token, uint256 anomalousAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _cKESAddress) initializer public {
        __Ownable_init(msg.sender);
        __Pausable_init();
        cKES = IcKES(_cKESAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Add or update an external token's peg rate against cKES.
     */
    function supportToken(address token, uint256 rateX18, uint256 dailyLimit) external onlyOwner {
        require(rateX18 > 0, "Rate must be positive");
        supportedTokens[token] = true;
        tokenRates[token] = rateX18;
        safeguards[token].dailyOutflowLimit = dailyLimit;
        // Do not reset the current window if just updating limits
        if (safeguards[token].windowStartTimestamp == 0) {
            safeguards[token].windowStartTimestamp = block.timestamp;
        }
        emit TokenSupported(token, rateX18, dailyLimit);
    }

    /**
     * @dev Remove support for an external token.
     */
    function removeToken(address token) external onlyOwner {
        supportedTokens[token] = false;
        tokenRates[token] = 0;
        safeguards[token].isCircuitBreakerTripped = true; // Quarantine remaining collateral
        emit TokenUnsupported(token);
    }

    /**
     * @dev Bridge an external token into the network, minting equivalent cKES to the user.
     * Note: cKES reserve accounting must be tracked separately or proxy-updated during this swap.
     */
    function bridgeIn(address token, uint256 amount) external nonReentrant whenNotPaused {
        require(supportedTokens[token], "Token not supported");
        require(amount > 0, "Amount must be greater than zero");

        uint256 rate = tokenRates[token];
        uint256 cKESToMint = (amount * rate) / 1e18;

        // Take external token liquidity into this router's pool
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Collateral Isolation: track exact emission created by this specific bridge token
        safeguards[token].totalMinted += cKESToMint;

        // In a real multi-collateral design, the LiquidityRouter acting as an avenue needs
        // permission to drive the verifiedReserveAmount hook on cKES, or be registered as an extension.
        // For now, we assume this router has Minter rights on cKES.
        cKES.mint(msg.sender, cKESToMint);

        emit LiquidityBridgedIn(msg.sender, token, amount, cKESToMint);
    }

    /**
     * @dev Bridge out of the network: Burn cKES and release the external token liquidity.
     */
    function bridgeOut(address token, uint256 cKESAmount) external nonReentrant whenNotPaused {
        require(supportedTokens[token], "Token not supported");
        require(cKESAmount > 0, "Amount must be greater than zero");

        TokenSafeguards storage guard = safeguards[token];
        require(!guard.isCircuitBreakerTripped, "LiquidityRouter: Token circuit breaker is tripped");
        require(cKESAmount <= guard.totalMinted, "LiquidityRouter: Exceeds isolated collateral");

        // --- Bridge Safeguards: Rate Limiter & Circuit Breaker ---
        if (block.timestamp > guard.windowStartTimestamp + RATE_LIMIT_WINDOW) {
            guard.currentDailyOutflow = 0;
            guard.windowStartTimestamp = block.timestamp;
        }

        guard.currentDailyOutflow += cKESAmount;

        if (guard.currentDailyOutflow > guard.dailyOutflowLimit) {
            // Anomalous spike detected! Trip the breaker and globally pause system
            guard.isCircuitBreakerTripped = true;
            _pause(); 
            emit CircuitBreakerTripped(token, cKESAmount);
            revert("LiquidityRouter: Circuit breaker tripped due to massive outflow");
        }

        guard.totalMinted -= cKESAmount;

        uint256 rate = tokenRates[token];
        uint256 tokensToRelease = (cKESAmount * 1e18) / rate;

        require(IERC20(token).balanceOf(address(this)) >= tokensToRelease, "Insufficient router liquidity");

        cKES.burn(msg.sender, cKESAmount);
        IERC20(token).safeTransfer(msg.sender, tokensToRelease);

        emit LiquidityBridgedOut(msg.sender, token, cKESAmount, tokensToRelease);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
