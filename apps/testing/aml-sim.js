/**
 * @file aml-sim.js
 * @description AML Financial Crime Simulator — Enhanced
 *
 * Simulates criminal wallet networks for stress testing the graph-based
 * monitoring / AML detection system. Now includes:
 *   - Detection speed metrics (how many txs before pattern would be flagged)
 *   - High-volume fan-out stress (50 rapid dispersals)
 *   - Rapid circular wash trading (20 loops in <500ms)
 *   - Structured JSON summary per pattern
 *   - Detection threshold simulation
 *
 * Original scenarios preserved and enhanced:
 *   Phase 1 — Fan-out laundering
 *   Phase 2 — Chain splitting & reconvergence
 *   Phase 3 — Circular wash trading
 *   Phase 4 (NEW) — High-volume rapid fan-out stress
 *   Phase 5 (NEW) — Rapid circular loop (20 iterations)
 *
 * Usage: node aml-sim.js
 */

require("dotenv").config();
const Redis = require("ioredis");
const { ethers } = require("ethers");

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const STREAM_NAME = "mpesa-mint-intents";

// AML Detection Thresholds (mirrors what a monitoring system would flag)
const DETECTION_THRESHOLDS = {
    FAN_OUT_DISTINCT_RECIPIENTS: 5,    // flag after 5+ unique recipients from 1 sender
    CIRCULAR_LOOP: 2,    // flag after 2+ circular transfers detected
    HIGH_VALUE_DISPERSAL: 3,    // flag after 3+ high-value txs from same source
    RAPID_BURST: 10,   // flag after 10+ txs from 1 wallet in <5s
};

// ── Helpers ──────────────────────────────────────────────────────────────────
let globalTxCount = 0;
const detectionLog = [];

async function pushTx(sender, recipient, amount, scenario) {
    globalTxCount++;
    const payload = {
        txId: `AML-SIM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        sender,
        recipient,
        amount,
        scenario,
        timestamp: new Date().toISOString(),
    };
    await redis.xadd(STREAM_NAME, "*", "payload", JSON.stringify(payload));
    return globalTxCount;
}

function checkDetection(pattern, txCountSinceStart, threshold) {
    if (txCountSinceStart >= threshold) {
        const log = {
            pattern,
            txsBeforeDetection: txCountSinceStart,
            threshold,
            detected: true,
            detectionTiming: txCountSinceStart === threshold ? "ON_THRESHOLD" : "AFTER_THRESHOLD",
        };
        detectionLog.push(log);
        console.log(`  🚨 [DETECTION] ${pattern} flagged at tx #${txCountSinceStart} (threshold: ${threshold})`);
        return true;
    }
    return false;
}

function logTx(amount, from, to) {
    console.log(`  💸 ${amount.toLocaleString()} KES: ${from.substring(0, 8)}... → ${to.substring(0, 8)}...`);
}

// ── Phase 1: Fan-Out Laundering (Original + Enhanced) ────────────────────────
async function simulateFanOut() {
    console.log("\n🕸️  Phase 1: Fan-Out Laundering (Dispersal)...");
    const kingpin = ethers.Wallet.createRandom().address;
    const phaseStart = Date.now();
    let txsThisPhase = 0;
    let detectedAt = null;

    for (let i = 0; i < 10; i++) {
        const mule = ethers.Wallet.createRandom().address;
        const count = await pushTx(kingpin, mule, 50000, "FAN_OUT");
        txsThisPhase++;
        logTx(50000, kingpin, mule);
        await new Promise(r => setTimeout(r, 50));

        if (!detectedAt && checkDetection("FAN_OUT", txsThisPhase, DETECTION_THRESHOLDS.FAN_OUT_DISTINCT_RECIPIENTS)) {
            detectedAt = count;
        }
    }

    return {
        pattern: "FAN_OUT",
        totalTxs: txsThisPhase,
        detectedAtTx: detectedAt,
        detectionWindowMs: Date.now() - phaseStart,
        threshold: DETECTION_THRESHOLDS.FAN_OUT_DISTINCT_RECIPIENTS,
    };
}

// ── Phase 2: Chain Reconvergence (Original) ───────────────────────────────────
async function simulateChainReconvergence() {
    console.log("\n🌀 Phase 2: Chain Splitting Reconvergence...");
    const mastermind = ethers.Wallet.createRandom().address;
    const accumulator = ethers.Wallet.createRandom().address;
    const phaseStart = Date.now();
    const mules = [];
    let txsThisPhase = 0;
    let detectedAt = null;

    for (let i = 0; i < 6; i++) {
        const mule = ethers.Wallet.createRandom().address;
        mules.push(mule);
        await pushTx(mastermind, mule, 10000, "SPLIT");
        txsThisPhase++;
        logTx(10000, mastermind, mule);
        await new Promise(r => setTimeout(r, 50));
    }

    console.log("  ⏳ Mules holding... reconverging in 2s...");
    await new Promise(r => setTimeout(r, 2000));

    for (const mule of mules) {
        const count = await pushTx(mule, accumulator, 9500, "RECONVERGENCE");
        txsThisPhase++;
        logTx(9500, mule, accumulator);
        await new Promise(r => setTimeout(r, 50));

        if (!detectedAt && checkDetection("CHAIN_RECONVERGENCE", txsThisPhase, DETECTION_THRESHOLDS.HIGH_VALUE_DISPERSAL)) {
            detectedAt = count;
        }
    }

    console.log(`  🎯 Reconvergence complete at: ${accumulator.substring(0, 16)}...`);

    return {
        pattern: "CHAIN_RECONVERGENCE",
        totalTxs: txsThisPhase,
        detectedAtTx: detectedAt,
        detectionWindowMs: Date.now() - phaseStart,
        threshold: DETECTION_THRESHOLDS.HIGH_VALUE_DISPERSAL,
    };
}

// ── Phase 3: Circular Wash Trading (Original + Enhanced) ─────────────────────
async function simulateCircularWashTrading() {
    console.log("\n🔄 Phase 3: Circular Wash Trading...");
    const a = ethers.Wallet.createRandom().address;
    const b = ethers.Wallet.createRandom().address;

    const phaseStart = Date.now();
    let txsThisPhase = 0;
    let detectedAt = null;

    await pushTx(a, b, 1000, "WASH_TRADE");
    txsThisPhase++;
    logTx(1000, a, b);

    await new Promise(r => setTimeout(r, 100));

    const count = await pushTx(b, a, 1000, "WASH_TRADE");
    txsThisPhase++;
    logTx(1000, b, a);

    if (checkDetection("CIRCULAR_WASH_TRADE", txsThisPhase, DETECTION_THRESHOLDS.CIRCULAR_LOOP)) {
        detectedAt = count;
    }

    return {
        pattern: "CIRCULAR_WASH_TRADE",
        totalTxs: txsThisPhase,
        detectedAtTx: detectedAt,
        detectionWindowMs: Date.now() - phaseStart,
        threshold: DETECTION_THRESHOLDS.CIRCULAR_LOOP,
    };
}

// ── Phase 4 (NEW): High-Volume Rapid Fan-Out Stress ───────────────────────────
async function simulateHighVolumeFanOut() {
    console.log("\n⚡ Phase 4 [NEW]: High-Volume Rapid Fan-Out (50 dispersals in <1s)...");
    const origin = ethers.Wallet.createRandom().address;
    const phaseStart = Date.now();
    const promises = [];
    let detectedAt = null;

    for (let i = 0; i < 50; i++) {
        const mule = ethers.Wallet.createRandom().address;
        promises.push(pushTx(origin, mule, 5000, "HIGH_VOL_FAN_OUT").then(count => {
            if (!detectedAt && count - (globalTxCount - 50) >= DETECTION_THRESHOLDS.RAPID_BURST) {
                detectedAt = count;
            }
        }));
    }
    await Promise.all(promises);
    const elapsed = Date.now() - phaseStart;

    console.log(`  ✅ 50 dispersals completed in ${elapsed}ms`);
    if (!detectedAt) checkDetection("HIGH_VOL_FAN_OUT", 50, DETECTION_THRESHOLDS.RAPID_BURST);

    return {
        pattern: "HIGH_VOL_FAN_OUT",
        totalTxs: 50,
        detectedAtTx: detectedAt || DETECTION_THRESHOLDS.RAPID_BURST,
        detectionWindowMs: elapsed,
        threshold: DETECTION_THRESHOLDS.RAPID_BURST,
    };
}

// ── Phase 5 (NEW): Rapid Circular Loop (20 iterations) ───────────────────────
async function simulateRapidCircularLoop() {
    console.log("\n🔁 Phase 5 [NEW]: Rapid Circular Transfer Loop (A→B→C→A × 20)...");
    const a = ethers.Wallet.createRandom().address;
    const b = ethers.Wallet.createRandom().address;
    const c = ethers.Wallet.createRandom().address;

    const phaseStart = Date.now();
    let txsThisPhase = 0;
    let detectedAt = null;
    const LOOPS = 20;

    for (let i = 0; i < LOOPS; i++) {
        await pushTx(a, b, 1000, "CIRCULAR_LOOP");
        txsThisPhase++;
        await pushTx(b, c, 950, "CIRCULAR_LOOP");
        txsThisPhase++;
        const count = await pushTx(c, a, 900, "CIRCULAR_LOOP"); // slight leak per loop
        txsThisPhase++;

        if (!detectedAt && txsThisPhase >= DETECTION_THRESHOLDS.CIRCULAR_LOOP) {
            detectedAt = count;
            checkDetection("RAPID_CIRCULAR_LOOP", txsThisPhase, DETECTION_THRESHOLDS.CIRCULAR_LOOP);
        }

        await new Promise(r => setTimeout(r, 20)); // <500ms total for 20 loops
    }

    const elapsed = Date.now() - phaseStart;
    console.log(`  ✅ ${LOOPS} circular loops (${txsThisPhase} txs) in ${elapsed}ms`);

    return {
        pattern: "RAPID_CIRCULAR_LOOP",
        totalTxs: txsThisPhase,
        loops: LOOPS,
        detectedAtTx: detectedAt,
        detectionWindowMs: elapsed,
        threshold: DETECTION_THRESHOLDS.CIRCULAR_LOOP,
    };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
    console.log("╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║       Mtiririko AML Financial Crime Simulator — v2                 ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log("║  5 attack patterns | Detection speed metrics | JSON summary         ║");
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    const results = [];

    results.push(await simulateFanOut());
    await new Promise(r => setTimeout(r, 1000));

    results.push(await simulateChainReconvergence());
    await new Promise(r => setTimeout(r, 1000));

    results.push(await simulateCircularWashTrading());
    await new Promise(r => setTimeout(r, 500));

    results.push(await simulateHighVolumeFanOut());
    await new Promise(r => setTimeout(r, 500));

    results.push(await simulateRapidCircularLoop());

    // ── Final Summary ─────────────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║                    AML SIMULATION SUMMARY                           ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log("║ Pattern                 │ Total Txs │ Detection At │ Window (ms)    ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    for (const r of results) {
        const pattern = r.pattern.substring(0, 22).padEnd(22);
        const total = String(r.totalTxs).padStart(9);
        const detAt = String(r.detectedAtTx ?? "N/A").padStart(12);
        const win = String(r.detectionWindowMs).padStart(14);
        console.log(`║ ${pattern} │ ${total} │ ${detAt} │ ${win}    ║`);
    }
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    const summary = {
        test: "aml-sim",
        timestamp: new Date().toISOString(),
        totalTxs: globalTxCount,
        patterns: results,
        detections: detectionLog,
    };
    console.log("\n📊 JSON Summary:\n" + JSON.stringify(summary, null, 2));
    console.log("\n✅ AML Simulation complete. Check consumer.js logs for risk scoring triggers.");

    await redis.quit();
    process.exit(0);
}

run().catch(async err => {
    console.error("❌ AML sim failed:", err.message);
    await redis.quit();
    process.exit(1);
});
