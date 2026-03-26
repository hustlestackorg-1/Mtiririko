const { ethers } = require("ethers");

class MtiririkoPay {
    /**
     * Initialize the Mtiririko Merchant SDK.
     * @param {string} merchantPrivateKey The merchant's private key for signing intents.
     * @param {number} chainId The network Chain ID (e.g. 42069 for Alfajores/Sepolia).
     * @param {string} settlementContractAddress The BatchSettlement.sol deployed address.
     */
    constructor(merchantPrivateKey, chainId, settlementContractAddress) {
        if (!merchantPrivateKey || !chainId || !settlementContractAddress) {
            throw new Error("Missing required configuration parameters.");
        }
        this.wallet = new ethers.Wallet(merchantPrivateKey);
        this.chainId = chainId;
        this.settlementContractAddress = settlementContractAddress;
    }

    /**
     * Create a signed abstract Transfer Intent.
     * @param {string} customerAddress The user's address who will pay (Note: for true merchant intents, 
     *     this might be swapped so the customer signs, but for B2B API integrations, the merchant signs on behalf of their custodial wallets).
     * @param {string} merchantRecipient The destination address for the funds.
     * @param {string} amountInKES The human-readable KES amount (e.g., "50.00").
     * @param {number} nonce The current nonce of the sender.
     * @param {number} expiryInSeconds How long until this intent expires (default 600s).
     * @returns {Object} the complete EIP-712 structured TransferRequest.
     */
    async createPaymentIntent(customerAddress, merchantRecipient, amountInKES, nonce, expiryInSeconds = 600) {
        const amountWei = ethers.parseUnits(amountInKES.toString(), 18);
        const expiry = Math.floor(Date.now() / 1000) + expiryInSeconds;

        const domain = {
            name: "MtiririkoBatch",
            version: "1",
            chainId: this.chainId,
            verifyingContract: this.settlementContractAddress
        };

        const types = {
            TransferRequest: [
                { name: "sender", type: "address" },
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "expiry", type: "uint256" },
                { name: "chainId", type: "uint256" }
            ]
        };

        const request = {
            sender: customerAddress,
            recipient: merchantRecipient,
            amount: amountWei.toString(), // Convert to string to avoid BigInt serialization issues across APIs
            nonce: nonce,
            expiry: expiry,
            chainId: this.chainId
        };

        // Standard EIP-712 signing over the structured intent
        const signature = await this.wallet.signTypedData(domain, types, request);

        return {
            ...request,
            signature
        };
    }

    /**
     * Validate an incoming response locally before pushing to the relayer.
     */
    verifyIntentSignature(request, signature) {
        const domain = {
            name: "MtiririkoBatch",
            version: "1",
            chainId: this.chainId,
            verifyingContract: this.settlementContractAddress
        };

        const types = {
            TransferRequest: [
                { name: "sender", type: "address" },
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "expiry", type: "uint256" },
                { name: "chainId", type: "uint256" }
            ]
        };

    /**
     * @dev Programmable Money API: Create a trigger-based condition for autonomous money.
     * @param {string} recipient The destination address
     * @param {string} amountInKES Human readable KES
     * @param {string} oracleAddress The API/Oracle allowed to sign off execution
     * @param {string} stringCondition Plain text condition (e.g., "TASK_123_DONE")
     * @param {number} expiryInSeconds
     */
    async createMoneyRule(recipient, amountInKES, oracleAddress, stringCondition, expiryInSeconds = 86400) {
            const amountWei = ethers.parseUnits(amountInKES.toString(), 18);
            const conditionHash = ethers.id(stringCondition);
            const ruleId = ethers.id(`${this.wallet.address}-${recipient}-${Date.now()}`);
            const expiry = Math.floor(Date.now() / 1000) + expiryInSeconds;

            return {
                ruleId,
                recipient,
                amount: amountWei.toString(),
                oracle: oracleAddress,
                conditionHash,
                expiry,
                sender: this.wallet.address,
                signature: await this.wallet.signMessage(ethers.getBytes(ethers.id(ruleId + conditionHash)))
            };
        }

    /**
     * @dev Programmable Money API: Atomically split a single payment across multiple stakeholders (e.g., Gig Economy, Creator Tipping).
     * @param {string} customerAddress The user funding the split
     * @param {string} totalAmountInKES The total pool of funds
     * @param {Array<Object>} splitArray Array of { recipient: address, bps: number } where 10000 bps = 100%
     */
    async autoSplitRevenue(customerAddress, totalAmountInKES, splitArray, baseNonce) {
            const totalAmountWei = ethers.parseUnits(totalAmountInKES.toString(), 18);
            let currentNonce = baseNonce;
            const intents = [];

            for (const split of splitArray) {
                const splitAmount = (totalAmountWei * BigInt(split.bps)) / 10000n;
                const intent = await this.createPaymentIntent(
                    customerAddress,
                    split.recipient,
                    ethers.formatUnits(splitAmount, 18),
                    currentNonce++
                );
                intents.push(intent);
            }
            return intents; // Return array of intents ready for batch processing
        }

    /**
     * @dev Programmable Money API: High-frequency micro-payments via State Channels (e.g., KES 1 for AI responses)
     * Off-chain only. Assumes openChannel() has already been mined.
     * @param {string} channelId The pre-existing channel ID
     * @param {string} updatedRecipientAmountInKES The new cumulative amount the recipient should receive
     */
    async sendInstant(channelId, updatedRecipientAmountInKES) {
            const amountWei = ethers.parseUnits(updatedRecipientAmountInKES.toString(), 18);

            // EIP-712 structured data or simple signed message mapping to PaymentChannels.sol expected signature
            const messageHash = ethers.solidityPackedKeccak256(
                ["bytes32", "uint256"],
                [channelId, amountWei.toString()]
            );

            const signature = await this.wallet.signMessage(ethers.getBytes(messageHash));

            return {
                channelId,
                recipientBalance: amountWei.toString(),
                signature
            };
        }
    }

module.exports = MtiririkoPay;
