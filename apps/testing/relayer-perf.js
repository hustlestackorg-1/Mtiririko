/**
 * @file relayer-perf.js
 * @description Relayer Performance Benchmark & Network Recovery Test
 *
 * Measures:
 *   - Intent pickup → batch submission latency (P50 / P95 / P99)
 *   - Concurrent relayer throughput under load
 *   - Network recovery speed: pause all consumers → resume → measure catch-up time
 *
 * Simulates the off-chain relayer worker process that reads from Redis streams
 * and submits batches to the blockchain layer.
 *
 * Usage:
 *   node relayer-perf.js
 *   node relayer-perf.js --relayers 5 --intents 2000 --pauseSec 30
 */

require("dotenv").config();
const Redis = require("ioredis");
const { ethers } = require("ethers");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2).reduce((acc, val, i, arr) => {
    if (val.startsWith("--")) acc[val.slice(2)] = arr[i + 1];
    return acc;
}, {});

const NUM_RELAYERS = parseInt(args.relayers || "5");
const TOTAL_INTENTS = parseInt(args.intents || "2000");
const PAUSE_SEC = parseInt(args.pauseSec || "30");
const BATCH_SIZE = parseInt(args.batchSize || "50");
const STREAM_NAME = "mpesa-mint-intents";
const GROUP_NAME = "relayer-perf-group";

// ── Shared metrics ────────────────────────────────────────────────────────────
const latencySamples = [];   // ms from xadd timestamp → processing completion
let totalProcessed = 0;
let totalBatches = 0;

// ── Redis factory (each relayer needs its own connection) ─────────────────────
function makeRedis() {
    return new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
}

// ── Percentile helper ─────────────────────────────────────────────────────────
function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

// ── Seed intents into the stream ──────────────────────────────────────────────
async function seedIntents(redis, count) {
    console.log(`\n📤 Seeding ${count} intents into Redis stream...`);
    const wallet = ethers.Wallet.createRandom();
    const recipient = ethers.Wallet.createRandom().address;
    const promises = [];

    for (let i = 0; i < count; i++) {
        const payload = {
            txId: `PERF-${Date.now()}-${i}`,
            sender: wallet.address,
            recipient,
            amount: Math.floor(Math.random() * 4990) + 10,
            queuedAt: Date.now(),   // used to measure pickup latency
            currency: "cKES",
        };
        promises.push(redis.xadd(STREAM_NAME, "*", "payload", JSON.stringify(payload)));
    }
    await Promise.all(promises);
    console.log(`✅ ${count} intents seeded.\n`);
}

// ── Single relayer worker ─────────────────────────────────────────────────────
async function relayerWorker(relayerId, paused) {
    const redis = makeRedis();

    // Create consumer group if it doesn't exist
    try {
        await redis.xgroup("CREATE", STREAM_NAME, GROUP_NAME, "0", "MKSTREAM");
    } catch (e) {
        if (!e.message.includes("BUSYGROUP")) throw e;
    }

    let batchesThisRelayer = 0;

    while (true) {
        if (paused.value) {
            await new Promise(r => setTimeout(r, 200));
            continue;
        }

        const results = await redis.xreadgroup(
            "GROUP", GROUP_NAME, `relayer-${relayerId}`,
            "COUNT", BATCH_SIZE,
            "BLOCK", 500,
            "STREAMS", STREAM_NAME, ">"
        );

        if (!results || !results[0]) continue;

        const messages = results[0][1];
        if (!messages.length) continue;

        const pickupTime = Date.now();
        const ids = [];

        for (const [id, fields] of messages) {
            const payload = JSON.parse(fields[1]);
            const queuedAt = payload.queuedAt || pickupTime;
            // Simulate batch verification + submission overhead (1-5ms per tx)
            await new Promise(r => setTimeout(r, Math.random() * 4 + 1));
            const latency = Date.now() - queuedAt;
            latencySamples.push(latency);
            ids.push(id);
        }

        // Acknowledge all messages in this batch
        await redis.xack(STREAM_NAME, GROUP_NAME, ...ids);
        totalProcessed += messages.length;
        totalBatches++;
        batchesThisRelayer++;

        if (totalProcessed >= TOTAL_INTENTS) break;
    }

    await redis.quit();
    return batchesThisRelayer;
}

// ── Network recovery test ─────────────────────────────────────────────────────
async function testNetworkRecovery(seedRedis) {
    console.log(`\n${"═".repeat(68)}`);
    console.log(`🔌 NETWORK RECOVERY TEST — Pausing all ${NUM_RELAYERS} relayers for ${PAUSE_SEC}s`);
    console.log(`${"═".repeat(68)}`);

    // Seed a fresh batch for recovery testing
    const RECOVERY_INTENTS = 500;
    await seedIntents(seedRedis, RECOVERY_INTENTS);

    const paused = { value: false };

    // Start relayers — they'll run freely first
    const relayerPromises = Array.from({ length: NUM_RELAYERS }, (_, i) =>
        relayerWorker(i + 1, paused)
    );

    // Let relayers pick up half the work, then pause
    await new Promise(r => setTimeout(r, 2000));
    const backlogBefore = await seedRedis.xlen(STREAM_NAME);

    console.log(`⏸️  Pausing all relayers. Remaining backlog: ${backlogBefore} intents`);
    const pauseStart = Date.now();
    paused.value = true;

    // During pause, inject more intents to simulate continued incoming traffic
    await seedIntents(seedRedis, 200);
    await new Promise(r => setTimeout(r, PAUSE_SEC * 1000));

    const backlogDuringPause = await seedRedis.xlen(STREAM_NAME);
    console.log(`▶️  Resuming relayers. Backlog accumulated during pause: ${backlogDuringPause} intents`);
    paused.value = false;

    const recoveryStart = Date.now();

    // Wait for relayers to drain
    await Promise.all(relayerPromises);

    const recoveryTime = Date.now() - recoveryStart;

    console.log(`\n✅ Network Recovery Complete`);
    console.log(`   Pause duration      : ${PAUSE_SEC}s`);
    console.log(`   Backlog at resume   : ${backlogDuringPause} intents`);
    console.log(`   Recovery time       : ${recoveryTime}ms (${(recoveryTime / 1000).toFixed(1)}s)`);
    console.log(`   Catch-up rate       : ~${Math.round(backlogDuringPause / (recoveryTime / 1000))} intents/s`);

    return { recoveryTimeMs: recoveryTime, backlogAtResume: backlogDuringPause };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log("╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║          Mtiririko Relayer Performance Benchmark                    ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log(`║  Relayers     : ${String(NUM_RELAYERS).padStart(5)}                                          ║`);
    console.log(`║  Total Intents: ${String(TOTAL_INTENTS).padStart(5)}                                          ║`);
    console.log(`║  Batch Size   : ${String(BATCH_SIZE).padStart(5)}                                          ║`);
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    const seedRedis = makeRedis();

    // ── Phase 1: Concurrent Relayer Throughput ──
    console.log(`\n${"═".repeat(68)}`);
    console.log(`⚡ PHASE 1: Concurrent Relayer Throughput (${NUM_RELAYERS} relayers × ${TOTAL_INTENTS} intents)`);
    console.log(`${"═".repeat(68)}`);

    // Clean up any leftover stream data
    try { await seedRedis.del(STREAM_NAME); } catch { }

    await seedIntents(seedRedis, TOTAL_INTENTS);

    const throughputStart = Date.now();
    const paused = { value: false };

    await Promise.all(
        Array.from({ length: NUM_RELAYERS }, (_, i) => relayerWorker(i + 1, paused))
    );

    const throughputMs = Date.now() - throughputStart;
    const sortedLatencies = [...latencySamples].sort((a, b) => a - b);

    console.log(`\n📊 Phase 1 Results:`);
    console.log(`   Total Processed      : ${totalProcessed} intents`);
    console.log(`   Total Batches        : ${totalBatches}`);
    console.log(`   Total Time           : ${throughputMs}ms (${(throughputMs / 1000).toFixed(1)}s)`);
    console.log(`   Throughput           : ~${Math.round(totalProcessed / (throughputMs / 1000))} intents/s`);
    console.log(`\n   Pickup→Submit Latency:`);
    console.log(`     P50 : ${percentile(sortedLatencies, 50)}ms`);
    console.log(`     P95 : ${percentile(sortedLatencies, 95)}ms`);
    console.log(`     P99 : ${percentile(sortedLatencies, 99)}ms`);
    console.log(`     Max : ${sortedLatencies[sortedLatencies.length - 1] || 0}ms`);

    // ── Phase 2: Network Recovery ──
    // Reset state
    latencySamples.length = 0;
    totalProcessed = 0;
    totalBatches = 0;
    try { await seedRedis.del(STREAM_NAME); } catch { }

    const recovery = await testNetworkRecovery(seedRedis);

    // ── Final JSON Summary ──
    const summary = {
        test: "relayer-perf",
        timestamp: new Date().toISOString(),
        config: { num_relayers: NUM_RELAYERS, total_intents: TOTAL_INTENTS, batch_size: BATCH_SIZE },
        phase1_throughput: {
            total_processed: totalProcessed + TOTAL_INTENTS,
            total_time_ms: throughputMs,
            p50_latency_ms: percentile(sortedLatencies, 50),
            p95_latency_ms: percentile(sortedLatencies, 95),
            p99_latency_ms: percentile(sortedLatencies, 99),
        },
        phase2_recovery: recovery,
    };

    console.log("\n\n📊 JSON Summary:\n" + JSON.stringify(summary, null, 2));

    await seedRedis.quit();
    process.exit(0);
}

main().catch(async (err) => {
    console.error("❌ Relayer benchmark failed:", err.message);
    process.exit(1);
});
