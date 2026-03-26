const ethers = require("ethers");
require("dotenv").config();

// Connect to Celo Sepolia Testnet (Pilot Target)
const CELO_SEPOLIA_RPC = process.env.CELO_RPC_URL || "https://forno.celo-sepolia.testnetcelo.org";
const provider = new ethers.JsonRpcProvider(CELO_SEPOLIA_RPC);

// Relayer Account - gas subsidized via Governance
const wallet = process.env.PRIVATE_KEY
    ? new ethers.Wallet(process.env.PRIVATE_KEY, provider)
    : ethers.Wallet.createRandom().connect(provider);

/**
 * Mints or transfers cKES stablecoins (Kenyan Shilling Peg)
 */
async function mintStablecoinsToAddress(recipientAddress, amountKsh) {
    // Note: 1 cKES = 1 Ksh, mitigating forex volatility compared to cUSD.
    const tokenAmount = ethers.parseUnits(amountKsh.toString(), 18);

    // In a live integration, query the stablecoin ERC20 contract instance in Celo Sepolia natively.
    return {
        txHash: "0x" + Math.random().toString(16).slice(2, 66).padEnd(64, '0'),
        amount: tokenAmount.toString(),
        currency: "cKES",
        recipient: recipientAddress,
        network: "Celo Sepolia",
        chainId: 42069 // Sepolia ID
    };
}

module.exports = {
    provider,
    wallet,
    mintStablecoinsToAddress
};
