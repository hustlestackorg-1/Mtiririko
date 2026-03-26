const express = require("express");
const router = express.Router();
// Removed stateful blockchain service dependency to keep Gateway stateless
// const blockchain = require("../services/blockchain");

// Redis setup for true stateless intent queues
const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

class MessageBroker {
    static async publish(topic, intent) {
        // XADD: topic, * (auto ID), payload, JSON.stringify(intent)
        // This is much lighter than Kafka and scales efficiently for early stage.
        const msgId = await redis.xadd(topic, "*", "payload", JSON.stringify(intent));
        return { messageId: msgId };
    }
}


/**
 * @route POST /api/v1/mpesa/webhook
 * @desc Simulates an M-Pesa IPN, pushes stateless Intent to the Queue
 */
router.post("/webhook", async (req, res) => {
    const logger = req.logger || console;
    try {
        const { TransAmount, BillRefNumber, MSISDN, TransID } = req.body;

        logger.info(`Received Webhook MSISDN: ${MSISDN}, Amount: ${TransAmount}`);

        // Format an Intent instead of direct execution
        const mintIntent = {
            intentType: "MINT_cKES",
            amountKsh: TransAmount,
            msisdn: MSISDN,
            darajaTransId: TransID,
            reference: BillRefNumber,
            timestamp: new Date().toISOString()
        };

        // Push to Message Broker (Queue) for Relayer consumption
        const brokerResult = await MessageBroker.publish("mpesa-mint-intents", mintIntent);

        logger.info(`Stateless Intent Pushed to Queue via Broker. MsgID: ${brokerResult.messageId}`);

        res.status(200).json({
            message: "Intent received and queued successfully",
            brokerId: brokerResult.messageId
        });
    } catch (error) {
        if (req.logger) {
            req.logger.error("Error processing Request:", { error: error.message, stack: error.stack });
        } else {
            console.error("Error process Request:", error);
        }
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
