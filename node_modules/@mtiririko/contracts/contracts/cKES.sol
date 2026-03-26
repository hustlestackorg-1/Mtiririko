// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title cKES - Custodial Reserve Mtiririko Token
 * @dev 1 cKES = 1 KES. Fully backed by M-Pesa deposits held in escrow.
 */
contract cKES is ERC20, Ownable {
    uint256 public constant SUPPLY_CAP = 1_000_000_000_000 * 10**18; // 1 Trillion cKES Cap
    uint256 public verifiedReserveAmount; // Snapshot of off-chain M-Pesa balance
    bytes32 public latestReserveHash; // IPFS/Merkle root of the auditor report

    event ReserveVerified(uint256 amount, bytes32 reserveHash, uint256 timestamp);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);

    constructor() ERC20("Mtiririko KES", "cKES") Ownable(msg.sender) {}

    /**
     * @dev Mint new cKES. Only called by the Middleware after an M-Pesa deposit.
     * HARD ENFORCEMENT: The system CANNOT mint unbacked tokens. 
     * minted_supply <= escrow_balance is strictly verified.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= SUPPLY_CAP, "cKES: Exceeds supply cap");
        require(totalSupply() + amount <= verifiedReserveAmount, "cKES: Insufficient backing in reserve");
        
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @dev Burn cKES. Called when user withdraws back to M-Pesa.
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
        emit TokensBurned(from, amount);
    }

    // --- Multi-source Reserve Attestation (M-of-N) ---
    uint256 public requiredOracles = 2;
    mapping(address => bool) public isOracle;
    // keccak256(amount, reserveHash) => oracle => hasAttested
    mapping(bytes32 => mapping(address => bool)) public hasAttested;
    // keccak256(amount, reserveHash) => count
    mapping(bytes32 => uint256) public attestationCount;

    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);
    event ThresholdUpdated(uint256 newThreshold);

    function addOracle(address oracle) external onlyOwner {
        isOracle[oracle] = true;
        emit OracleAdded(oracle);
    }

    function removeOracle(address oracle) external onlyOwner {
        isOracle[oracle] = false;
        emit OracleRemoved(oracle);
    }

    function setRequiredOracles(uint256 threshold) external onlyOwner {
        require(threshold > 0, "Threshold must be > 0");
        requiredOracles = threshold;
        emit ThresholdUpdated(threshold);
    }

    /**
     * @dev Hook for distributed oracles (Auditor, Bank API, Treasury) to post proof of 1:1 reserve backing.
     * @param newReserveAmount The new total balance of the M-Pesa escrow
     * @param reserveHash Merkle root or IPFS hash of the daily auditor attestation
     */
    function submitReserveAttestation(uint256 newReserveAmount, bytes32 reserveHash) external {
        require(isOracle[msg.sender], "cKES: Caller is not a registered oracle");

        bytes32 attestationId = keccak256(abi.encode(newReserveAmount, reserveHash));
        require(!hasAttested[attestationId][msg.sender], "cKES: Oracle already attested this payload");

        hasAttested[attestationId][msg.sender] = true;
        attestationCount[attestationId]++;

        // If threshold reached, formalize the state update
        if (attestationCount[attestationId] >= requiredOracles) {
            if (verifiedReserveAmount != newReserveAmount || latestReserveHash != reserveHash) {
                verifiedReserveAmount = newReserveAmount;
                latestReserveHash = reserveHash;
                emit ReserveVerified(newReserveAmount, reserveHash, block.timestamp);
            }
        }
    }

    /**
     * @dev Ensures the token is fully backed. Can be used by clients/explorers.
     */
    function isFullyBacked() external view returns (bool) {
        return verifiedReserveAmount >= totalSupply();
    }
}
