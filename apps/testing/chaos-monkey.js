/**
 * @file chaos-monkey.js
 * @description Chaos Engineering Suite — Enhanced
 *
 * Enhanced from baseline to cover:
 *   1. Redis backlog overflow (original)
 *   2. RPC latency / gas spike (original)
 *   3. Batch settlement failure simulation (NEW)
 *   4. Relayer fleet disappearance (80% offline) (NEW)
 *   5. MTTD measurement: time from fault injection → monitor alert
 *
 * The MTTD loop works by:
 *   - Publishing a fault signal to the `chaos-monkey-signals` channel
 *   - Subscribing to `chaos-monkey-ack` and recording when monitor.js fires back
 *   - Printing Mean Time To Detection in milliseconds
 *
 * Usage: node chaos-monkey.js
 */

require("dotenv").config();
const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const redisSub = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379"); // separate sub conn
const STREAM_NAME = "mpesa-mint-intents";

// Tracks fault injection timestamps for MTTD computation
const mttdLog = [];

// ── Fault signal helper ───────────────────────────────────────────────────────
async function injectFault(type, payload = {}) {
    const injectedAt = Date.now();
    await redis.publish("chaos-monkey-signals", JSON.stringify({ type, ...payload, injectedAt }));
    console.log(`  💉 Fault injected: [${type}] at ${new Date(injectedAt).toISOString()}`);
    return injectedAt;
}

// ── MTTD listener ─────────────────────────────────────────────────────────────
function startMTTDListener() {
    return new Promise((resolve) => {
        redisSub.subscribe("chaos-monkey-ack", (err) => {
            if (err) console.error("  ⚠️  MTTD listener subscription failed:", err.message);
        });

        const acks = [];
        redisSub.on("message", (channel, message) => {
            if (channel !== "chaos-monkey-ack") return;
            try {
                const data = JSON.parse(message);
                const detectedAt = Date.now();
                const mttd = detectedAt - (data.injectedAt || detectedAt);
                acks.push({ type: data.type, mttd_ms: mttd, detectedAt });
                mttdLog.push({ type: data.type, mttd_ms: mttd });
                console.log(`  📡 [MTTD] Alert received for [${data.type}]: ${mttd}ms after injection`);
            } catch { }
        });

        // Close after 15 seconds (enough time for monitor.js to react)
        setTimeout(() => {
            redisSub.unsubscribe("chaos-monkey-ack");
            resolve(acks);
        }, 15000);
    });
}

// ── Fault 1: Redis Backlog Overflow (original + metric) ───────────────────────
async function simulateBacklogOverflow() {
    console.log("\n🐒 [CHAOS-1] Simulating Redis Backlog Overflow...");
    const injectedAt = Date.now();

    // Inject 10,500 dummy payloads — monitor.js alert threshold is 1,000
    const promises = [];
    for (let i = 0; i < 10500; i++) {
        const payload = JSON.stringify({ chaos: true, scenario: "BACKLOG_OVERFLOW", idx: i });
        promises.push(redis.xadd(STREAM_NAME, "*", "payload", payload));
    }
    await Promise.all(promises);

    const backlog = await redis.xlen(STREAM_NAME);
    console.log(`  🧨 Backlog inflated to ${backlog} items in ${Date.now() - injectedAt}ms`);
    console.log(`  🧹 Clean up: redis-cli DEL ${STREAM_NAME}`);

    // Signal monitor.js
    await injectFault("BACKLOG_OVERFLOW", { backlogSize: backlog });
}

// ── Fault 2: RPC Latency / Gas Spike (original + metric) ─────────────────────
async function simulateRPCLatencySpike() {
    console.log("\n🐒 [CHAOS-2] Simulating L1 RPC Latency / Gas Spike...");
    await injectFault("GAS_SPIKE", { value: 500, unit: "gwei" });
    console.log("  🧨 Sent 500 gwei gas spike signal to observability nodes.");
}

// ── Fault 3 (NEW): Batch Settlement Failure ────────────────────────────────────
async function simulateBatchSettlementFailure() {
    console.log("\n🐒 [CHAOS-3] Simulating Batch Settlement Failure...");
    // Publish a signal that the on-chain batch settlement call reverted
    await injectFault("BATCH_SETTLEMENT_FAILURE", {
        batchId: `CHAOS-BATCH-${Date.now()}`,
        errorReason: "SIMULATED_REVERT: Insufficient gas / RPC timeout",
        affectedTxs: 50,
    });
    console.log("  🧨 Batch settlement failure signal emitted.");
    console.log("  ⚠️  Monitor should generate CRITICAL ALERT within MTTD window.");
}

// ── Fault 4 (NEW): Relayer Fleet Disappearance (80%) ────────────────────────
async function simulateRelayerDisappearance() {
    console.log("\n🐒 [CHAOS-4] Simulating 80% Relayer Fleet Disappearance...");

    const simulatedRelayers = [
        "0xRelayer1", "0xRelayer2", "0xRelayer3", "0xRelayer4",
        "0xRelayer5", "0xRelayer6", "0xRelayer7", "0xRelayer8",
    ];
    const offlineRelayers = simulatedRelayers.slice(0, 7); // 7 of 8 = 87.5% offline

    await injectFault("RELAYER_FLEET_OFFLINE", {
        totalRelayers: simulatedRelayers.length,
        offlineRelayers: offlineRelayers.length,
        offlinePercent: Math.round((offlineRelayers.length / simulatedRelayers.length) * 100),
        relayersOffline: offlineRelayers,
        remainingOnline: simulatedRelayers.length - offlineRelayers.length,
    });

    console.log(`  🧨 ${offlineRelayers.length}/${simulatedRelayers.length} relayers reported offline.`);
    console.log("  ⚠️  Monitor should alert: network degraded, batch processing at risk.");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runChaos() {
    console.log("╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║       Mtiririko Chaos Engineering Suite — v2                       ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log("║  4 fault scenarios | MTTD measurement | Observability integration  ║");
    console.log("╚══════════════════════════════════════════════════════════════════════╝");
    console.log("\n⏱️  Starting MTTD listener (15s window for monitor.js acks)...");

    const mttdPromise = startMTTDListener();

    // Inject all faults
    await simulateBacklogOverflow();
    await new Promise(r => setTimeout(r, 2000));
    await simulateRPCLatencySpike();
    await new Promise(r => setTimeout(r, 2000));
    await simulateBatchSettlementFailure();
    await new Promise(r => setTimeout(r, 2000));
    await simulateRelayerDisappearance();

    console.log("\n⏳ Waiting for monitor.js acks (up to 15s)...");
    const acks = await mttdPromise;

    // ── MTTD Report ──────────────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║                    CHAOS MONKEY FINAL REPORT                        ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log("║ Fault Type                    │ MTTD (ms)   │ Status                ║");
    console.log("╠══════════════════════════════════════════════════════════════════════╣");

    const faultTypes = ["BACKLOG_OVERFLOW", "GAS_SPIKE", "BATCH_SETTLEMENT_FAILURE", "RELAYER_FLEET_OFFLINE"];
    for (const type of faultTypes) {
        const ack = acks.find(a => a.type === type);
        const mttd = ack ? `${ack.mttd_ms}ms` : "NOT DETECTED";
        const status = ack ? "✅ Detected" : "⚠️  No ack";
        const label = type.substring(0, 28).padEnd(28);
        const mttdStr = mttd.padStart(11);
        console.log(`║ ${label} │ ${mttdStr} │ ${status.padEnd(21)} ║`);
    }

    const avgMTTD = mttdLog.length
        ? Math.round(mttdLog.reduce((a, b) => a + b.mttd_ms, 0) / mttdLog.length)
        : "N/A";

    console.log("╠══════════════════════════════════════════════════════════════════════╣");
    console.log(`║  Average MTTD: ${String(avgMTTD + "ms").padEnd(53)} ║`);
    console.log(`║  Faults injected: 4   Faults acknowledged: ${String(acks.length).padEnd(26)} ║`);
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    const summary = {
        test: "chaos-monkey",
        timestamp: new Date().toISOString(),
        faults_injected: 4,
        faults_detected: acks.length,
        avg_mttd_ms: avgMTTD,
        results: mttdLog,
    };
    console.log("\n📊 JSON Summary:\n" + JSON.stringify(summary, null, 2));

    console.log("\n✅ Chaos Monkey run complete.");
    await redis.quit();
    await redisSub.quit();
    process.exit(0);
}

runChaos().catch(async err => {
    console.error("❌ Chaos monkey failed:", err.message);
    await redis.quit();
    await redisSub.quit();
    process.exit(1);
});
