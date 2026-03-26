/**
 * @file monitor.js
 * @description Mtiririko Network Observability Node — Enhanced
 *
 * Monitors:
 *   1. Intent queue backlog (Redis stream length)
 *   2. On-chain gas spikes (RPC fee data)
 *   3. On-chain BatchSettlement events (failures, successes, compressions)
 *   4. Chaos-monkey signal subscription → MTTD measurement + ack
 *   5. MTTD / alert counter tracking
 *   6. Pilot metric dashboard (every 60s): active wallets, avg fee, fraud rate, relayer count
 */

require("dotenv").config();
const Redis = require("ioredis");
const { ethers } = require("ethers");

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const redisSub = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const JSONRPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const provider = new ethers.JsonRpcProvider(JSONRPC);

const BATCH_SETTLEMENT_ABI = [
    "event BatchProcessed(uint256 totalTransfers, uint256 totalAmount, uint256 totalRelayerFees)",
    "event TransferFailed(address indexed sender, address indexed recipient, uint256 amount, string reason)",
    "event CompressedBatchCommitted(address indexed relayer, bytes32 merkleRoot, uint256 totalSwaps, uint256 timestamp)",
];

// ── Alert Counters & MTTD Tracker ─────────────────────────────────────────────
const alertCounters = {
    queue_overflows: 0,
    gas_spikes: 0,
    batch_failures: 0,
    transfer_failures: 0,
    successful_batches: 0,
    compressed_batches: 0,
    relayer_fleet_alerts: 0,
    total_alerts_triggered: 0,
};

const mttdHistory = []; // { type, injectedAt, detectedAt, mttd_ms }

// ── Pilot Metric State (simulated — in production pulled from DB/indexer) ─────
const pilotMetrics = {
    daily_active_wallets: 0,
    total_transactions_today: 0,
    total_fees_collected: BigInt(0),
    fraud_alerts_today: 0,
    active_relayer_count: 0,
    avg_settlement_ms: 0,
    uptime_start: Date.now(),
};

// ── Alert helper ──────────────────────────────────────────────────────────────
function alert(level, message, data = {}) {
    const prefix = level === "CRITICAL" ? "🚨" : level === "WARN" ? "⚠️ " : "ℹ️ ";
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${prefix} [${level}] ${message}`, Object.keys(data).length ? data : "");
    alertCounters.total_alerts_triggered++;
}

// ── 1. Intent Queue Monitor ───────────────────────────────────────────────────
setInterval(async () => {
    try {
        const backlog = await redis.xlen("mpesa-mint-intents");
        console.log(`[QUEUE_METRICS] Backlog: ${backlog} pending intents`);

        if (backlog > 10000) {
            alertCounters.queue_overflows++;
            alert("CRITICAL", `Queue CRITICAL: ${backlog} items (>10k threshold)`, { backlog });
        } else if (backlog > 1000) {
            alertCounters.queue_overflows++;
            alert("WARN", `Queue HIGH: ${backlog} items. Consider scaling relayers.`, { backlog });
        }

        pilotMetrics.total_transactions_today += backlog > 0 ? 1 : 0;
    } catch (e) {
        if (e.message?.includes("ERR no such key")) {
            console.log(`[QUEUE_METRICS] Backlog: 0 (stream empty)`);
        }
    }
}, 5000);

// ── 2. On-Chain Gas Spike Monitor ────────────────────────────────────────────
let lastGasAlertTime = 0;
setInterval(async () => {
    try {
        const feeData = await provider.getFeeData();
        const gasPriceGwei = ethers.formatUnits(feeData.gasPrice || 0n, "gwei");
        console.log(`[GAS_ORACLE] BaseFee: ${parseFloat(gasPriceGwei).toFixed(2)} gwei`);

        if (parseFloat(gasPriceGwei) > 50 && Date.now() - lastGasAlertTime > 60000) {
            alertCounters.gas_spikes++;
            lastGasAlertTime = Date.now();
            alert("WARN", `Gas spike! ${gasPriceGwei} gwei — dynamic fees scaling.`, { gwei: gasPriceGwei });
        }
    } catch { /* RPC unavailable during testing */ }
}, 10000);

// ── 3. On-Chain Contract Event Monitor ───────────────────────────────────────
if (process.env.SETTLEMENT_CONTRACT_ADDRESS) {
    const batchContract = new ethers.Contract(
        process.env.SETTLEMENT_CONTRACT_ADDRESS,
        BATCH_SETTLEMENT_ABI,
        provider
    );
    console.log(`[EVENT_MONITOR] Bound to Settlement: ${process.env.SETTLEMENT_CONTRACT_ADDRESS}`);

    batchContract.on("TransferFailed", (sender, recipient, amount, reason) => {
        alertCounters.transfer_failures++;
        alertCounters.batch_failures++;
        pilotMetrics.fraud_alerts_today++;
        alert("CRITICAL", `On-chain TransferFailed: ${reason}`, { sender, recipient, amount: amount.toString(), reason });
    });

    batchContract.on("BatchProcessed", (successes, amount, fee) => {
        alertCounters.successful_batches++;
        pilotMetrics.total_fees_collected += fee;
        pilotMetrics.daily_active_wallets += Number(successes);
        console.log(`[SETTLEMENT_SUCCESS] ${successes} txs settled. Amount: ${ethers.formatUnits(amount, 18)} cKES. Fee: ${ethers.formatUnits(fee, 18)} cKES`);
    });

    batchContract.on("CompressedBatchCommitted", (relayer, root, swaps, ts) => {
        alertCounters.compressed_batches++;
        console.log(`[L2_COMPRESSION] Merkle root committed by ${relayer} (${swaps} swaps)`);
    });
} else {
    console.log("[EVENT_MONITOR] No SETTLEMENT_CONTRACT_ADDRESS set — skipping on-chain hooks.");
}

// ── 4. Chaos-Monkey Signal Subscriber & MTTD Measurer ───────────────────────
redisSub.subscribe("chaos-monkey-signals", (err) => {
    if (err) console.error("[CHAOS_SUB] Subscription error:", err.message);
    else console.log("[CHAOS_SUB] Subscribed to chaos-monkey-signals channel.");
});

redisSub.on("message", async (channel, message) => {
    if (channel !== "chaos-monkey-signals") return;

    const detectedAt = Date.now();
    let data;
    try { data = JSON.parse(message); } catch { return; }

    const mttd = data.injectedAt ? detectedAt - data.injectedAt : null;
    const mttdDisplay = mttd !== null ? `MTTD=${mttd}ms` : "no injectedAt timestamp";

    mttdHistory.push({ type: data.type, injectedAt: data.injectedAt, detectedAt, mttd_ms: mttd });

    switch (data.type) {
        case "BACKLOG_OVERFLOW":
            alertCounters.queue_overflows++;
            alert("CRITICAL", `[CHAOS] Backlog overflow detected. ${mttdDisplay}`, data);
            break;
        case "GAS_SPIKE":
            alertCounters.gas_spikes++;
            alert("WARN", `[CHAOS] Gas spike signal received (${data.value} gwei). ${mttdDisplay}`, data);
            break;
        case "BATCH_SETTLEMENT_FAILURE":
            alertCounters.batch_failures++;
            alert("CRITICAL", `[CHAOS] Batch settlement failure! Batch: ${data.batchId}. ${mttdDisplay}`, data);
            break;
        case "RELAYER_FLEET_OFFLINE":
            alertCounters.relayer_fleet_alerts++;
            pilotMetrics.active_relayer_count = data.remainingOnline || 0;
            alert("CRITICAL", `[CHAOS] ${data.offlinePercent}% relayers offline! Only ${data.remainingOnline} active. ${mttdDisplay}`, data);
            break;
        default:
            alert("WARN", `[CHAOS] Unknown signal: ${data.type}. ${mttdDisplay}`, data);
    }

    // Acknowledge back to chaos-monkey for MTTD measurement
    await redis.publish("chaos-monkey-ack", JSON.stringify({
        type: data.type,
        injectedAt: data.injectedAt,
        detectedAt,
        mttd_ms: mttd,
    }));
});

// ── 5. Pilot Metric Dashboard (every 60s) ────────────────────────────────────
setInterval(() => {
    const uptimeMs = Date.now() - pilotMetrics.uptime_start;
    const uptimeMin = Math.floor(uptimeMs / 60000);

    console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║                 MTIRIRIKO PILOT METRIC DASHBOARD                    ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log(`║  Uptime                    : ${String(uptimeMin + " min").padEnd(38)} ║`);
    console.log(`║  Daily Active Wallets      : ${String(pilotMetrics.daily_active_wallets).padEnd(38)} ║`);
    console.log(`║  Total Txs Today           : ${String(pilotMetrics.total_transactions_today).padEnd(38)} ║`);
    console.log(`║  Active Relayers           : ${String(pilotMetrics.active_relayer_count || "N/A").padEnd(38)} ║`);
    console.log(`║  Fraud Alerts Today        : ${String(pilotMetrics.fraud_alerts_today).padEnd(38)} ║`);
    console.log(`║  Total Fees Collected (cKES): ${String(ethers.formatUnits(pilotMetrics.total_fees_collected, 18)).padEnd(37)} ║`);
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log("║  ALERT COUNTERS                                                      ║");
    console.log(`║  Total Alerts Fired        : ${String(alertCounters.total_alerts_triggered).padEnd(38)} ║`);
    console.log(`║  Queue Overflows           : ${String(alertCounters.queue_overflows).padEnd(38)} ║`);
    console.log(`║  Gas Spikes                : ${String(alertCounters.gas_spikes).padEnd(38)} ║`);
    console.log(`║  Batch Failures            : ${String(alertCounters.batch_failures).padEnd(38)} ║`);
    console.log(`║  Successful Batches        : ${String(alertCounters.successful_batches).padEnd(38)} ║`);
    console.log(`║  Relayer Fleet Alerts      : ${String(alertCounters.relayer_fleet_alerts).padEnd(38)} ║`);

    if (mttdHistory.length) {
        const validMttds = mttdHistory.filter(m => m.mttd_ms !== null);
        const avgMttd = validMttds.length
            ? Math.round(validMttds.reduce((a, b) => a + b.mttd_ms, 0) / validMttds.length)
            : 0;
        console.log("╠══════════════════════════════════════════════════════════════════════╣");
        console.log(`║  Avg MTTD                  : ${String(avgMttd + " ms").padEnd(38)} ║`);
        console.log(`║  Faults Detected           : ${String(validMttds.length).padEnd(38)} ║`);
    }

    console.log("╚══════════════════════════════════════════════════════════════════════╝\n");
}, 60000);

// ── Startup banner ────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════════════════════════╗");
console.log("║          Mtiririko Network Observability Node — v2                  ║");
console.log("╠══════════════════════════════════════════════════════════════════════╣");
console.log("║  Queue monitor    : every 5s                                         ║");
console.log("║  Gas oracle       : every 10s                                        ║");
console.log("║  Pilot dashboard  : every 60s                                        ║");
console.log("║  Chaos subscriber : active (chaos-monkey-signals channel)            ║");
console.log("║  MTTD tracking    : active                                           ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝\n");
