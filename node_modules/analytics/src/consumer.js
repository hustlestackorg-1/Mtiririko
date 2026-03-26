require("dotenv").config();
const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const mongoose = require("mongoose");
const crypto = require("crypto");

// Hash function for PII compliance
function hashData(data) {
    if (!data) return null;
    return crypto.createHash("sha256").update(data.toString()).digest("hex");
}

const transactionSchema = new mongoose.Schema({
    txId: String,
    senderHash: String, // Hashed PII
    recipientHash: String, // Hashed PII
    amount: Number,
    timestamp: Date,
    locationData: String,
    platform: String
});

const TransactionModel = mongoose.model("TransactionMetrics", transactionSchema);

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/mtiririko");
        console.log("Connected to MongoDB for Insights");

        const recentSenderCounts = new Map();
        const recentTransfers = new Map();

        // AML Graph Analysis Memory Stores
        const senderToRecipients = new Map();
        const recipientToSenders = new Map();
        const walletRiskScores = new Map();

        const RISK_THRESHOLD = 50;

        function addRiskScore(walletHash, points, reason) {
            let current = walletRiskScores.get(walletHash) || 0;
            current += points;
            walletRiskScores.set(walletHash, current);

            if (current >= RISK_THRESHOLD) {
                console.warn(`[AML STATISTICAL DRIFT ALERT] Wallet ${walletHash} breached risk threshold. Score: ${current}. Trigger: ${reason}`);
            }
        }

        console.log("Redis Consumer started, listening for transactions on Stream...");

        let lastId = "$"; // Read only new messages initially

        while (true) {
            // XREAD BLOCK 5000 STREAMS mpesa-mint-intents lastId
            const results = await redis.xread("BLOCK", 5000, "STREAMS", "mpesa-mint-intents", lastId);

            if (results) {
                const stream = results[0];
                const messages = stream[1];

                for (let i = 0; i < messages.length; i++) {
                    const messageId = messages[i][0];
                    const fields = messages[i][1];
                    lastId = messageId; // Update lastId for the next read

                    // Parse the JSON payload from the 'payload' field
                    let data = {};
                    for (let j = 0; j < fields.length; j += 2) {
                        if (fields[j] === "payload") {
                            data = JSON.parse(fields[j + 1]);
                        }
                    }
                    const now = Date.now();
                    const sHash = hashData(data.sender);
                    const rHash = hashData(data.recipient);

                    if (data.amount > 1000000) {
                        console.warn(`[ANOMALY DETECTED] High value KYC check needed for Tx: ${data.txId}`);
                        // Trigger SMS/Email Alert mock here
                    }

                    // --- 1. Probabilistic Velocity Scoring ---
                    if (!recentSenderCounts.has(sHash)) {
                        recentSenderCounts.set(sHash, { count: 1, firstTx: now });
                        addRiskScore(sHash, 1, "Standard Transfer");
                    } else {
                        let stats = recentSenderCounts.get(sHash);
                        if (now - stats.firstTx < 60000) { // within 1 minute
                            stats.count++;
                            // Exponential risk points for aggressive velocity looping
                            addRiskScore(sHash, Math.pow(2, stats.count), "Aggressive Velocity Anomaly");
                        } else {
                            recentSenderCounts.set(sHash, { count: 1, firstTx: now });
                            addRiskScore(sHash, 1, "Standard Transfer");
                        }
                    }

                    // --- 2. Circular Transfer Scoring ---
                    const circularKey = `${rHash}-${sHash}`; // If recipient previously sent to sender
                    if (recentTransfers.has(circularKey)) {
                        const lastTime = recentTransfers.get(circularKey);
                        if (now - lastTime < 300000) { // within 5 minutes
                            addRiskScore(sHash, 15, "Circular Wash Trading");
                            addRiskScore(rHash, 15, "Circular Wash Trading");
                        }
                    }
                    recentTransfers.set(`${sHash}-${rHash}`, now);

                    // --- 3. Graph Entropy & Centrality Scoring ---
                    if (!senderToRecipients.has(sHash)) senderToRecipients.set(sHash, new Set());
                    senderToRecipients.get(sHash).add(rHash);

                    if (!recipientToSenders.has(rHash)) recipientToSenders.set(rHash, new Set());
                    recipientToSenders.get(rHash).add(sHash);

                    // A: Structural Dispersal Entropy (Fan-Out Laundering)
                    if (senderToRecipients.get(sHash).size > 5) {
                        addRiskScore(sHash, 5, `High Dispersal Entropy (Fan-Out: ${senderToRecipients.get(sHash).size})`);
                    }

                    // B: Chain Splitting Reconvergence (Centrality Risk)
                    if (recipientToSenders.get(rHash).size >= 3) {
                        let sendersFeedingTarget = Array.from(recipientToSenders.get(rHash));
                        for (let [origin, targets] of senderToRecipients.entries()) {
                            if (origin === rHash) continue;
                            let structuralOverlap = 0;
                            for (let feed of sendersFeedingTarget) {
                                if (targets.has(feed)) structuralOverlap++;
                            }
                            // If intermediate wallets were ORIGINALLY funded by the same origin
                            if (structuralOverlap >= 3) {
                                addRiskScore(origin, 25, "Chain Reconvergence (Originator)");
                                addRiskScore(rHash, 25, "Chain Reconvergence (Accumulator)");
                            }
                        }
                    }

                    // Save Anonymized PII to DB
                    await TransactionModel.create({
                        txId: data.txId,
                        senderHash: hashData(data.sender),
                        recipientHash: hashData(data.recipient),
                        amount: data.amount,
                        timestamp: new Date(data.timestamp),
                        locationData: data.locationData || "Unknown",
                        platform: data.platform || "Unknown"
                    });

                    console.log(`[ANALYTICS] Ingested anonymized Tx ${data.txId} for ${data.amount} Ksh`);
                } // end per-message processing
            } // end if (results)
        } // end while(true)
    } catch (e) {
        console.error("Error setting up Fast Redis Analytics streaming", e);
    }
}

run().catch(console.error);

// Export model for Dashboard read access
module.exports = { TransactionModel };
