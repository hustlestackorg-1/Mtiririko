/**
 * @file batch-latency.js
 * @description Batch Pipeline Latency Tracker
 *
 * Tracks each intent through the full state machine:
 *   Pending → Batched → Finalized
 *
 * Measures:
 *   - Time from intent creation to batch pickup (pending latency)
 *   - Time from batch pickup to finalization signal (settlement throughput)
 *   - Transactions processed per batch cycle
 *   - End-to-end pipeline latency distribution
 *
 * Usage:
 *   node batch-latency.js
 *   node batch-latency.js --intents 500 --batchSize 50 --workers 3
 */

require("dotenv").config();
const Redis = require("ioredis");
const { ethers } = require("ethers");

const args = process.argv.slice(2).reduce((acc, val, i, arr) => {
    if (val.startsWith("--")) acc[val.slice(2)] = arr[i + 1];
    return acc;
}, {});

const TOTAL_INTENTS = parseInt(args.intents || "500");
const BATCH_SIZE = parseInt(args.batchSize || "50");
const BATCH_WORKERS = parseInt(args.workers || "3");
const STREAM_NAME = "mpesa-mint-intents";
const FINALIZED_KEY = "mtiririko:finalized-intents";

// Intent state machine
const STATES = { PENDING: "PENDING", BATCHED: "BATCHED", FINALIZED: "FINALIZED" };

// Track per-intent timestamps
const intentTimestamps = new Map(); // txId → { created, batched, finalized }

function makeRedis() {
    return new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
}

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

// ── Phase 1: Create intents (PENDING state) ───────────────────────────────────
async function createIntents(redis) {
    console.log(`\n📝 Creating ${TOTAL_INTENTS} intents in PENDING state...`);
    const wallet = ethers.Wallet.createRandom();
    const recipient = ethers.Wallet.createRandom().address;
    const promises = [];

    for (let i = 0; i < TOTAL_INTENTS; i++) {
        const txId = `BATCH-LAT-${Date.now()}-${i}`;
        const createdAt = Date.now();
        intentTimestamps.set(txId, { state: STATES.PENDING, created: createdAt });

        const payload = {
            txId,
            sender: wallet.address,
            recipient,
            amount: Math.floor(Math.random() * 4990) + 10,
            createdAt,
            state: STATES.PENDING,
        };
        promises.push(redis.xadd(STREAM_NAME, "*", "payload", JSON.stringify(payload)));
    }

    await Promise.all(promises);
    console.log(`✅ ${TOTAL_INTENTS} intents in PENDING state.\n`);
}

// ── Phase 2: Batch processor worker (PENDING → BATCHED → FINALIZED) ──────────
async function batchProcessorWorker(workerId, processedShared) {
    const redis = makeRedis();
    const GROUP = "batch-latency-group";
    let batchCount = 0;

    try {
        await redis.xgroup("CREATE", STREAM_NAME, GROUP, "0", "MKSTREAM");
    } catch (e) {
        if (!e.message.includes("BUSYGROUP")) throw e;
    }

    while (processedShared.count < TOTAL_INTENTS) {
        const results = await redis.xreadgroup(
            "GROUP", GROUP, `worker-${workerId}`,
            "COUNT", BATCH_SIZE,
            "BLOCK", 500,
            "STREAMS", STREAM_NAME, ">"
        );

        if (!results || !results[0]) continue;
        const messages = results[0][1];
        if (!messages.length) continue;

        const batchId = `batch-${workerId}-${batchCount++}`;
        const batchStart = Date.now();
        const ids = [];
        const batchTxIds = [];

        // ── Transition: PENDING → BATCHED ────────────────────────────────────
        for (const [id, fields] of messages) {
            const payload = JSON.parse(fields[1]);
            const txId = payload.txId;
            ids.push(id);
            batchTxIds.push(txId);

            if (intentTimestamps.has(txId)) {
                const entry = intentTimestamps.get(txId);
                entry.batched = Date.now();
                entry.state = STATES.BATCHED;
                entry.batchId = batchId;
            }
        }

        // Simulate batch verification + Merkle root computation (real-world ~20-80ms)
        const verificationMs = 20 + Math.random() * 60;
        await new Promise(r => setTimeout(r, verificationMs));

        // ── Transition: BATCHED → FINALIZED ──────────────────────────────────
        // Simulate on-chain settlement confirmation (Celo ~5s blocks, here compressed to 50-150ms)
        const settlementMs = 50 + Math.random() * 100;
        await new Promise(r => setTimeout(r, settlementMs));

        const finalizedAt = Date.now();

        for (const txId of batchTxIds) {
            if (intentTimestamps.has(txId)) {
                const entry = intentTimestamps.get(txId);
                entry.finalized = finalizedAt;
                entry.state = STATES.FINALIZED;
            }
        }

        // Publish finalization signal (observability layer hooks here)
        await redis.publish("mtiririko:batch-finalized", JSON.stringify({
            batchId,
            workerId,
            txCount: messages.length,
            batchTimeMs: Date.now() - batchStart,
            timestamp: new Date().toISOString(),
        }));

        // Acknowledge
        await redis.xack(STREAM_NAME, GROUP, ...ids);
        processedShared.count += messages.length;

        console.log(
            `  [Worker ${workerId}] Batch ${batchId}: ${messages.length} txs | ` +
            `settle=${Math.round(settlementMs)}ms | total=${Date.now() - batchStart}ms | ` +
            `cumulative=${processedShared.count}/${TOTAL_INTENTS}`
        );
    }

    await redis.quit();
}

// ── Compute and print latency distribution ────────────────────────────────────
function analyzeLatencies() {
    const pendingLatencies = [];   // created → batched
    const settlementLatencies = [];  // batched → finalized
    const e2eLatencies = [];   // created → finalized
    let txPerBatchMap = new Map();
    let unfinished = 0;

    for (const [txId, ts] of intentTimestamps.entries()) {
        if (!ts.finalized) { unfinished++; continue; }

        const pendingMs = ts.batched - ts.created;
        const settlementMs = ts.finalized - ts.batched;
        const e2eMs = ts.finalized - ts.created;

        pendingLatencies.push(pendingMs);
        settlementLatencies.push(settlementMs);
        e2eLatencies.push(e2eMs);

        if (ts.batchId) {
            if (!txPerBatchMap.has(ts.batchId)) txPerBatchMap.set(ts.batchId, 0);
            txPerBatchMap.set(ts.batchId, txPerBatchMap.get(ts.batchId) + 1);
        }
    }

    const sort = arr => [...arr].sort((a, b) => a - b);
    const sortedPending = sort(pendingLatencies);
    const sortedSettlement = sort(settlementLatencies);
    const sortedE2E = sort(e2eLatencies);

    const avgTxPerBatch = txPerBatchMap.size
        ? Math.round([...txPerBatchMap.values()].reduce((a, b) => a + b, 0) / txPerBatchMap.size)
        : 0;

    return {
        total_finalized: e2eLatencies.length,
        unfinished,
        total_batches: txPerBatchMap.size,
        avg_tx_per_batch: avgTxPerBatch,
        pending_latency_ms: {
            p50: percentile(sortedPending, 50),
            p95: percentile(sortedPending, 95),
            p99: percentile(sortedPending, 99),
            avg: Math.round(sortedPending.reduce((a, b) => a + b, 0) / (sortedPending.length || 1)),
        },
        settlement_latency_ms: {
            p50: percentile(sortedSettlement, 50),
            p95: percentile(sortedSettlement, 95),
            p99: percentile(sortedSettlement, 99),
            avg: Math.round(sortedSettlement.reduce((a, b) => a + b, 0) / (sortedSettlement.length || 1)),
        },
        e2e_latency_ms: {
            p50: percentile(sortedE2E, 50),
            p95: percentile(sortedE2E, 95),
            p99: percentile(sortedE2E, 99),
            avg: Math.round(sortedE2E.reduce((a, b) => a + b, 0) / (sortedE2E.length || 1)),
        },
    };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log("╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║         Mtiririko Batch Pipeline Latency Tracker                    ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log(`║  Total Intents   : ${String(TOTAL_INTENTS).padStart(5)} (Pending → Batched → Finalized)      ║`);
    console.log(`║  Batch Size      : ${String(BATCH_SIZE).padStart(5)} txs per batch                       ║`);
    console.log(`║  Batch Workers   : ${String(BATCH_WORKERS).padStart(5)}                                        ║`);
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    const redis = makeRedis();
    try { await redis.del(STREAM_NAME); } catch { }

    await createIntents(redis);

    console.log(`⚙️  Starting ${BATCH_WORKERS} batch processor workers...\n`);
    const pipelineStart = Date.now();
    const processedShared = { count: 0 };

    await Promise.all(
        Array.from({ length: BATCH_WORKERS }, (_, i) =>
            batchProcessorWorker(i + 1, processedShared)
        )
    );

    const totalPipelineMs = Date.now() - pipelineStart;
    const analysis = analyzeLatencies();

    console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║                  BATCH PIPELINE LATENCY REPORT                      ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log(`║  Total Pipeline Time    : ${String(totalPipelineMs).padStart(7)}ms                          ║`);
    console.log(`║  Total Finalized        : ${String(analysis.total_finalized).padStart(7)} intents                     ║`);
    console.log(`║  Total Batches          : ${String(analysis.total_batches).padStart(7)}                              ║`);
    console.log(`║  Avg Tx per Batch       : ${String(analysis.avg_tx_per_batch).padStart(7)}                              ║`);
    console.log(`║  Settlement Throughput  : ~${String(Math.round(analysis.total_finalized / (totalPipelineMs / 1000))).padStart(6)} intents/s                   ║`);
    console.log("║                                                                      ║");
    console.log("║  PENDING LATENCY (intent created → batch pickup)                    ║");
    console.log(`║    P50 : ${String(analysis.pending_latency_ms.p50).padStart(6)}ms  P95 : ${String(analysis.pending_latency_ms.p95).padStart(6)}ms  P99 : ${String(analysis.pending_latency_ms.p99).padStart(6)}ms ║`);
    console.log("║                                                                      ║");
    console.log("║  SETTLEMENT LATENCY (batch pickup → finalized on-chain)              ║");
    console.log(`║    P50 : ${String(analysis.settlement_latency_ms.p50).padStart(6)}ms  P95 : ${String(analysis.settlement_latency_ms.p95).padStart(6)}ms  P99 : ${String(analysis.settlement_latency_ms.p99).padStart(6)}ms ║`);
    console.log("║                                                                      ║");
    console.log("║  END-TO-END LATENCY (intent created → finalized)                    ║");
    console.log(`║    P50 : ${String(analysis.e2e_latency_ms.p50).padStart(6)}ms  P95 : ${String(analysis.e2e_latency_ms.p95).padStart(6)}ms  P99 : ${String(analysis.e2e_latency_ms.p99).padStart(6)}ms ║`);
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    const summary = { test: "batch-latency", timestamp: new Date().toISOString(), ...analysis };
    console.log("\n📊 JSON Summary:\n" + JSON.stringify(summary, null, 2));

    await redis.quit();
    process.exit(0);
}

main().catch(err => {
    console.error("❌ Batch latency tracker failed:", err.message);
    process.exit(1);
});
