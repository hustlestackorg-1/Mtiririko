/**
 * @file load-test.js
 * @description Mtiririko High-Traffic Load Test
 *
 * Simulates realistic payment intent ingestion including:
 *   - Baseline traffic (1,000 TPS)
 *   - 10× spike traffic (10,000 TPS) mid-run
 *   - Per-second structured metrics: ingestion_rate, ingestion_latency_ms, queue_backlog
 *   - Queue backlog growth rate tracking during spike window
 *
 * Usage:
 *   node load-test.js                  → default (1k TPS baseline → 10k TPS spike)
 *   node load-test.js --baseline 500 --peak 5000 --duration 30
 */

require("dotenv").config();
const Redis = require("ioredis");
const { ethers } = require("ethers");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2).reduce((acc, val, i, arr) => {
    if (val.startsWith("--")) acc[val.slice(2)] = arr[i + 1];
    return acc;
}, {});

const BASELINE_TPS = parseInt(args.baseline || "1000");
const PEAK_TPS = parseInt(args.peak || "10000");
const DURATION_SEC = parseInt(args.duration || "30");
const SPIKE_START_AT = parseInt(args.spikeAt || "10"); // seconds into run before spike

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const STREAM_NAME = "mpesa-mint-intents";

// ── Metrics State ─────────────────────────────────────────────────────────────
const metrics = {
    totalSent: 0,
    totalErrors: 0,
    secondSnapshots: [],   // { second, ingestion_rate, ingestion_latency_ms, queue_backlog, phase }
    backlogAtSpikeStart: 0,
    backlogAtSpikeEnd: 0,
};

async function getQueueBacklog() {
    try {
        const len = await redis.xlen(STREAM_NAME);
        return len;
    } catch {
        return -1;
    }
}

function printMetricsHeader() {
    console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║         Mtiririko Load Test — 10× Traffic Spike Simulation          ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log(`║  Baseline TPS : ${String(BASELINE_TPS).padStart(7)}                                       ║`);
    console.log(`║  Peak TPS     : ${String(PEAK_TPS).padStart(7)}  (10× spike at t+${SPIKE_START_AT}s)              ║`);
    console.log(`║  Duration     : ${String(DURATION_SEC).padStart(7)}s                                      ║`);
    console.log("╚══════════════════════════════════════════════════════════════════════╝\n");
    console.log("SEC | PHASE    | TPS TARGET | SENT  | LATENCY(ms) | BACKLOG | Δ BACKLOG");
    console.log("----+----------+------------+-------+-------------+---------+----------");
}

function printSecondMetric(snap) {
    const phase = snap.phase.padEnd(8);
    const tps = String(snap.tps_target).padStart(10);
    const sent = String(snap.sent_this_sec).padStart(5);
    const latency = String(snap.ingestion_latency_ms).padStart(11);
    const backlog = String(snap.queue_backlog).padStart(7);
    const delta = (snap.backlog_delta >= 0 ? "+" : "") + String(snap.backlog_delta).padStart(9);
    const sec = String(snap.second).padStart(3);
    console.log(`${sec} | ${phase} | ${tps} | ${sent} | ${latency} | ${backlog} | ${delta}`);
}

async function runLoadTest() {
    printMetricsHeader();

    const wallet = ethers.Wallet.createRandom();
    const recipient = ethers.Wallet.createRandom().address;

    const startTime = Date.now();
    let secondCounter = 0;
    let prevBacklog = 0;

    return new Promise((resolve) => {
        const ticker = setInterval(async () => {
            secondCounter++;
            const isSpike = secondCounter > SPIKE_START_AT;
            const currentTPS = isSpike ? PEAK_TPS : BASELINE_TPS;
            const phase = isSpike ? "SPIKE" : "BASELINE";

            if (isSpike && secondCounter === SPIKE_START_AT + 1) {
                metrics.backlogAtSpikeStart = await getQueueBacklog();
                console.log(`\n⚡ SPIKE INITIATED at t+${secondCounter}s — ramping to ${PEAK_TPS} TPS\n`);
            }

            const batchStart = Date.now();
            const promises = [];

            for (let i = 0; i < currentTPS; i++) {
                const payload = {
                    txId: `LOAD-${Date.now()}-${i}`,
                    sender: wallet.address,
                    recipient,
                    amount: Math.floor(Math.random() * 9990) + 10,
                    currency: "cKES",
                    timestamp: new Date().toISOString(),
                    phase,
                };
                promises.push(
                    redis.xadd(STREAM_NAME, "*", "payload", JSON.stringify(payload))
                        .catch(() => { metrics.totalErrors++; })
                );
            }

            await Promise.all(promises);
            const latencyMs = Date.now() - batchStart;
            const backlog = await getQueueBacklog();
            const deltaBacklog = backlog - prevBacklog;

            metrics.totalSent += currentTPS;
            prevBacklog = backlog;

            const snap = {
                second: secondCounter,
                phase,
                tps_target: currentTPS,
                sent_this_sec: currentTPS,
                ingestion_latency_ms: latencyMs,
                queue_backlog: backlog,
                backlog_delta: deltaBacklog,
            };
            metrics.secondSnapshots.push(snap);
            printSecondMetric(snap);

            if (secondCounter >= DURATION_SEC) {
                clearInterval(ticker);
                metrics.backlogAtSpikeEnd = backlog;
                await printFinalReport(startTime);
                resolve();
            }
        }, 1000);
    });
}

async function printFinalReport(startTime) {
    const totalTime = (Date.now() - startTime) / 1000;
    const spikeSnaps = metrics.secondSnapshots.filter(s => s.phase === "SPIKE");
    const baseSnaps = metrics.secondSnapshots.filter(s => s.phase === "BASELINE");

    const avg = (arr, key) => arr.length ? Math.round(arr.reduce((a, b) => a + b[key], 0) / arr.length) : 0;

    const backlogGrowthRate = spikeSnaps.length > 0
        ? Math.round((metrics.backlogAtSpikeEnd - metrics.backlogAtSpikeStart) / spikeSnaps.length)
        : 0;

    console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║                     LOAD TEST FINAL REPORT                          ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log(`║  Total Intents Sent     : ${String(metrics.totalSent).padStart(10)}                        ║`);
    console.log(`║  Total Errors           : ${String(metrics.totalErrors).padStart(10)}                        ║`);
    console.log(`║  Total Duration         : ${String(totalTime.toFixed(1)).padStart(10)}s                       ║`);
    console.log("║                                                                      ║");
    console.log("║  BASELINE PHASE                                                      ║");
    console.log(`║    Avg Ingestion Latency: ${String(avg(baseSnaps, "ingestion_latency_ms")).padStart(7)} ms                        ║`);
    console.log(`║    Avg Backlog Growth   : ${String(avg(baseSnaps, "backlog_delta")).padStart(7)} items/s                    ║`);
    console.log("║                                                                      ║");
    console.log("║  10× SPIKE PHASE                                                     ║");
    console.log(`║    Avg Ingestion Latency: ${String(avg(spikeSnaps, "ingestion_latency_ms")).padStart(7)} ms                        ║`);
    console.log(`║    Backlog at Spike Start: ${String(metrics.backlogAtSpikeStart).padStart(6)} items                       ║`);
    console.log(`║    Backlog at Spike End  : ${String(metrics.backlogAtSpikeEnd).padStart(6)} items                       ║`);
    console.log(`║    Backlog Growth Rate   : ${String(backlogGrowthRate).padStart(6)} items/s during spike        ║`);
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    // Emit JSON summary for CI/monitoring pipelines
    const summary = {
        test: "load-test",
        timestamp: new Date().toISOString(),
        total_intents_sent: metrics.totalSent,
        total_errors: metrics.totalErrors,
        baseline: {
            tps_target: BASELINE_TPS,
            avg_latency_ms: avg(baseSnaps, "ingestion_latency_ms"),
            avg_backlog_delta: avg(baseSnaps, "backlog_delta"),
        },
        spike: {
            tps_target: PEAK_TPS,
            avg_latency_ms: avg(spikeSnaps, "ingestion_latency_ms"),
            backlog_growth_per_sec: backlogGrowthRate,
            backlog_start: metrics.backlogAtSpikeStart,
            backlog_end: metrics.backlogAtSpikeEnd,
        },
    };
    console.log("\n📊 JSON Summary:\n" + JSON.stringify(summary, null, 2));
    await redis.quit();
    process.exit(0);
}

runLoadTest().catch(async (err) => {
    console.error("❌ Load test failed:", err);
    await redis.quit();
    process.exit(1);
});
