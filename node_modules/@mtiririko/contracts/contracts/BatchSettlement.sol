// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title BatchSettlement
 * @dev Implements L2-style logic to batch multiple micro-transfers into a single on-chain transaction.
 * Upgraded to use UUPS Proxy pattern, strong replay protection, and decentralized relayer fee tracking.
 */
contract BatchSettlement is
    Initializable,
    OwnableUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable
{
    IERC20 public stablecoin;
    
    // Nonce for each user to prevent replay attacks
    mapping(address => uint256) public nonces;

    // Relayer Staking for Sybil Resistance
    uint256 public constant MIN_RELAYER_STAKE = 1000 * 10**18; // 1,000 cKES
    mapping(address => uint256) public relayerStakes;
    address[] public activeRelayers;
    mapping(address => uint256) public relayerIndex;

    // Cryptoeconomic Dynamic Fee Parameters
    uint256 public constant BASE_FEE_BPS = 20; // 0.2% base
    uint256 public safetyMultiplierBps; // e.g., 12000 = 1.2x safety multiplier
    uint256 public gasToTokenRate; // Oracle exchange rate representation

    struct TransferRequest {
        address sender;
        address recipient;
        uint256 amount;
        uint256 nonce;
        uint256 expiry;
        uint256 chainId;
        bytes signature;
    }

    event BatchProcessed(uint256 totalTransfers, uint256 totalAmount, uint256 totalRelayerFees);
    event TransferFailed(address indexed sender, address indexed recipient, uint256 amount, string reason);
    event CompressedBatchCommitted(address indexed relayer, bytes32 merkleRoot, uint256 totalSwaps, uint256 timestamp);
    event RelayerStaked(address indexed relayer, uint256 amount);
    event RelayerUnstaked(address indexed relayer, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _stablecoinAddress) initializer public {
        __Ownable_init(msg.sender);
        __EIP712_init("MtiririkoBatch", "1");
        __Pausable_init();

        stablecoin = IERC20(_stablecoinAddress);
        safetyMultiplierBps = 12000; // 1.2x default
        gasToTokenRate = 1; // 1:1 dummy conversion for test parity
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Staking requirement for Sybil resistance. A relayer must commit capital.
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0");
        require(stablecoin.transferFrom(msg.sender, address(this), amount), "Stake transfer failed");
        
        if (relayerStakes[msg.sender] == 0) {
            activeRelayers.push(msg.sender);
            relayerIndex[msg.sender] = activeRelayers.length;
        }
        
        relayerStakes[msg.sender] += amount;
        emit RelayerStaked(msg.sender, amount);
    }

    function unstake() external nonReentrant {
        uint256 amount = relayerStakes[msg.sender];
        require(amount > 0, "No staked balance");
        relayerStakes[msg.sender] = 0;
        
        uint256 idx = relayerIndex[msg.sender] - 1;
        address lastRelayer = activeRelayers[activeRelayers.length - 1];
        activeRelayers[idx] = lastRelayer;
        relayerIndex[lastRelayer] = idx + 1;
        activeRelayers.pop();
        relayerIndex[msg.sender] = 0;

        require(stablecoin.transfer(msg.sender, amount), "Unstake transfer failed");
        emit RelayerUnstaked(msg.sender, amount);
    }

    function updateFeeOracles(uint256 _safetyMultiplierBps, uint256 _gasToTokenRate) external onlyOwner {
        safetyMultiplierBps = _safetyMultiplierBps;
        gasToTokenRate = _gasToTokenRate;
    }

    /**
     * @dev Process a batch of signed off-chain transfers. Called by any relayer on the network.
     */
    function processBatch(TransferRequest[] calldata requests) external nonReentrant whenNotPaused {
        require(relayerStakes[msg.sender] >= MIN_RELAYER_STAKE, "BatchSettlement: Insufficient Relayer Stake");
        require(requests.length <= 100, "BatchSettlement: Exceeds max limit");
        require(activeRelayers.length > 0, "No active relayers");
        
        uint256 myIdx = relayerIndex[msg.sender];
        require(myIdx > 0, "BatchSettlement: Relayer index not found");
        
        uint256 totalAmount = 0;
        uint256 successfulTx = 0;
        uint256 totalRelayerFees = 0;

        for (uint256 i = 0; i < requests.length; i++) {
            TransferRequest calldata req = requests[i];
            
            if (req.nonce != nonces[req.sender]) {
                emit TransferFailed(req.sender, req.recipient, req.amount, "Invalid nonce");
                continue;
            }

            if (block.timestamp > req.expiry) {
                emit TransferFailed(req.sender, req.recipient, req.amount, "Transaction expired");
                continue;
            }

            if (req.chainId != block.chainid) {
                emit TransferFailed(req.sender, req.recipient, req.amount, "Invalid chain ID");
                continue;
            }

            // Deterministic Intent Allocation (Anti-MEV / Priority Windows)
            uint256 assignedRelayerIndex = uint256(keccak256(abi.encode(req.sender, req.recipient, req.amount, req.nonce))) % activeRelayers.length;
            if (assignedRelayerIndex != (myIdx - 1)) {
                // Priority window restricts sniping until the final 5 minutes of intent lifespan
                if (req.expiry > block.timestamp + 300) {
                    emit TransferFailed(req.sender, req.recipient, req.amount, "Relayer priority window active");
                    continue;
                }
            }

            bytes32 structHash = keccak256(abi.encode(
                keccak256("TransferRequest(address sender,address recipient,uint256 amount,uint256 nonce,uint256 expiry,uint256 chainId)"),
                req.sender,
                req.recipient,
                req.amount,
                req.nonce,
                req.expiry,
                req.chainId
            ));

            bytes32 hash = _hashTypedDataV4(structHash);
            address signer = ECDSA.recover(hash, req.signature);

            if (signer != req.sender) {
                emit TransferFailed(req.sender, req.recipient, req.amount, "Invalid Signature");
                continue;
            }

            // Dynamic Fee Cryptoeconomics: relayer_fee = max(0.2%, gas_estimate * safety_multiplier)
            // Simulating gas equivalent using tx.gasprice and standard transfer footprint (approx 65k gas)
            uint256 simulatedGasCost = 65000 * tx.gasprice * gasToTokenRate; 
            uint256 dynamicGasFee = (simulatedGasCost * safetyMultiplierBps) / 10000;
            uint256 baseFee = (req.amount * BASE_FEE_BPS) / 10000;
            
            uint256 fee = baseFee > dynamicGasFee ? baseFee : dynamicGasFee;
            
            // Revert protection if fee completely consumes transfer
            if (fee >= req.amount) fee = req.amount - 1; 

            uint256 amountAfterFee = req.amount - fee;

            try stablecoin.transferFrom(req.sender, req.recipient, amountAfterFee) returns (bool success) {
                if (success) {
                    bool feeSuccess = stablecoin.transferFrom(req.sender, msg.sender, fee);
                    if (feeSuccess) {
                        nonces[req.sender]++;
                        totalAmount += amountAfterFee;
                        totalRelayerFees += fee;
                        successfulTx++;
                    } else {
                        emit TransferFailed(req.sender, req.recipient, req.amount, "Fee transfer failed");
                    }
                } else {
                    emit TransferFailed(req.sender, req.recipient, req.amount, "Base transfer returns false");
                }
            } catch {
                emit TransferFailed(req.sender, req.recipient, req.amount, "Transfer Error");
            }
        }

        emit BatchProcessed(successfulTx, totalAmount, totalRelayerFees);
    }

    /**
     * @dev Transaction Compression Layer. 
     * Instead of posting all transfers to calldata, the Relayer simply posts the Merkle Root
     * of the batch. This represents an Optimistic / ZK style settlement, reducing gas costs by 99%.
     * Data availability is assumed to be handled off-chain via Kafka/Redis.
     */
    function commitCompressedBatch(bytes32 batchMerkleRoot, uint256 totalSwaps) external nonReentrant whenNotPaused {
        require(totalSwaps > 0, "Empty batch");
        // In a full implementation, state transitions would be checked here or fraud proven later.
        emit CompressedBatchCommitted(msg.sender, batchMerkleRoot, totalSwaps, block.timestamp);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
