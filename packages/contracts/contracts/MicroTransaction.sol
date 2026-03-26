// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MicroTransaction Engine for Mtiririko
/// @notice Handles atomic peer-to-peer logic bypassing extreme fees using stablecoins.
/// @dev Implements standard ERC20 routing abstracting complex functionality for rural edge devices.
contract MicroTransaction is Ownable {
    /// @notice The current recognized Stablecoin proxy address (e.g., cKES)
    IERC20 public stablecoin;

    /// @notice Raised when a P2P transfer finalizes natively
    /// @param sender Source account invoking or permitting transfer
    /// @param recipient Destination address
    /// @param amount Net transferred without fee subtraction
    event TransferProcessed(address indexed sender, address indexed recipient, uint256 amount);

    /// @param _stablecoinAddress The active stablecoin mapped to Celo Sepolia
    constructor(address _stablecoinAddress) Ownable(msg.sender) {
        stablecoin = IERC20(_stablecoinAddress);
    }

    /// @notice Process an atomic fiat-pegged transfer simulating Ksh behaviors.
    /// @dev System depends extensively on Relayers to execute calls masking absolute fees entirely.
    /// @param recipient User ID routing finalization.
    /// @param amount Disbursed capital peg limit.
    function p2pTransfer(address recipient, uint256 amount) external {
        require(amount > 0, "Amount must be greater than zero");
        
        bool success = stablecoin.transferFrom(msg.sender, recipient, amount);
        require(success, "Transfer failed");

        emit TransferProcessed(msg.sender, recipient, amount);
    }

    /// @notice Changes the backing Stablecoin mapping globally.
    /// @param _newStablecoin Updated smart contract route to conform to future CBDC issuance.
    function updateStablecoin(address _newStablecoin) external onlyOwner {
        stablecoin = IERC20(_newStablecoin);
    }
}
