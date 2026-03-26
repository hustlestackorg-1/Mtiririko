require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.24",
        settings: {
            evmVersion: "cancun", // Required for OpenZeppelin v5 (mcopy opcode)
            viaIR: true,          // Solves Stack Too Deep limits in large functions
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        alfajores: { // Deprecated/legacy target
            url: "https://alfajores-forno.celo-testnet.org",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 44787
        },
        sepolia: { // New Primary pilot testnet
            url: "https://forno.celo-sepolia.testnetcelo.org",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 42069 // Celo Sepolia Testnet ID 
        }
    }
};
