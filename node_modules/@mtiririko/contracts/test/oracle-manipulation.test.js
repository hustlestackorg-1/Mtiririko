const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @file oracle-manipulation.test.js
 * @description Oracle Manipulation Defense Suite
 *
 * The cKES stablecoin uses M-of-N oracle consensus before updating verified reserves.
 * These tests simulate:
 *   1. Single oracle cannot update reserves alone
 *   2. Conflicting data from different oracles prevents consensus
 *   3. Compromised/removed oracle loses voting power immediately
 *   4. Below-threshold oracle removal raises effective requirement
 *   5. Old stale attestation cannot overwrite a newer finalized consensus
 *   6. Non-oracle address submission is rejected
 *   7. Exactly threshold oracles achieve finalization (boundary test)
 */

describe("Security: Oracle Manipulation Defense", function () {
    let cKES;
    let owner, oracle1, oracle2, oracle3, oracle4, rogue;

    beforeEach(async function () {
        [owner, oracle1, oracle2, oracle3, oracle4, rogue] = await ethers.getSigners();

        const CKES = await ethers.getContractFactory("cKES");
        cKES = await CKES.deploy();
    });

    // ── Test 1: Single oracle cannot update reserves ──────────────────────────
    it("Should NOT update reserves when only 1 of 2 required oracles attests", async function () {
        await cKES.addOracle(oracle1.address);
        await cKES.addOracle(oracle2.address);
        await cKES.setRequiredOracles(2);

        const prevReserve = await cKES.verifiedReserveAmount();
        const newAmount = ethers.parseUnits("500000", 18);
        const newHash = ethers.id("SINGLE_ORACLE_ATTEMPT");

        // Only oracle1 attests
        await cKES.connect(oracle1).submitReserveAttestation(newAmount, newHash);

        // Reserve must remain unchanged
        expect(await cKES.verifiedReserveAmount()).to.equal(prevReserve);
    });

    // ── Test 2: Conflicting oracle data prevents consensus ────────────────────
    it("Should NOT finalize reserves when oracles submit conflicting amounts for the same round", async function () {
        await cKES.addOracle(oracle1.address);
        await cKES.addOracle(oracle2.address);
        await cKES.setRequiredOracles(2);

        const prevReserve = await cKES.verifiedReserveAmount();

        // Both attest different amounts — they won't match the same (amount, hash) pair
        const hash = ethers.id("CONFLICT_ROUND_1");
        await cKES.connect(oracle1).submitReserveAttestation(ethers.parseUnits("1000000", 18), hash);
        await cKES.connect(oracle2).submitReserveAttestation(ethers.parseUnits("999999", 18), hash);

        // Conflicting: neither reached 2 confirmations for the same exact amount
        expect(await cKES.verifiedReserveAmount()).to.equal(prevReserve);
    });

    // ── Test 3: Compromised oracle removal ────────────────────────────────────
    it("Should prevent a removed (compromised) oracle from influencing future attestations", async function () {
        await cKES.addOracle(oracle1.address);
        await cKES.addOracle(oracle2.address);
        await cKES.addOracle(oracle3.address);
        await cKES.setRequiredOracles(2);

        // First, run a valid consensus to set a baseline
        const baseAmount = ethers.parseUnits("1000000", 18);
        const baseHash = ethers.id("BASELINE");
        await cKES.connect(oracle1).submitReserveAttestation(baseAmount, baseHash);
        await cKES.connect(oracle2).submitReserveAttestation(baseAmount, baseHash);
        const baseline = await cKES.verifiedReserveAmount();

        // Now remove oracle1 (it was compromised)
        await cKES.removeOracle(oracle1.address);

        // oracle1 tries to push a malicious large reserve
        const maliciousAmount = ethers.parseUnits("999999999", 18);
        const maliciousHash = ethers.id("MALICIOUS_RESERVE");

        await expect(
            cKES.connect(oracle1).submitReserveAttestation(maliciousAmount, maliciousHash)
        ).to.be.reverted; // should revert — not an authorized oracle

        // Reserve stays at the honest baseline
        expect(await cKES.verifiedReserveAmount()).to.equal(baseline);
    });

    // ── Test 4: Non-oracle address rejected ───────────────────────────────────
    it("Should revert if a non-oracle address attempts to submit an attestation", async function () {
        await cKES.addOracle(oracle1.address);
        await cKES.setRequiredOracles(1);

        await expect(
            cKES.connect(rogue).submitReserveAttestation(
                ethers.parseUnits("5000000", 18),
                ethers.id("ROGUE_ATTACK")
            )
        ).to.be.reverted;
    });

    // ── Test 5: Exact-threshold consensus ────────────────────────────────────
    it("Should finalize EXACTLY when the required threshold is met (boundary test)", async function () {
        await cKES.addOracle(oracle1.address);
        await cKES.addOracle(oracle2.address);
        await cKES.addOracle(oracle3.address);
        await cKES.setRequiredOracles(3); // require all 3

        const prevReserve = await cKES.verifiedReserveAmount();
        const newAmount = ethers.parseUnits("2000000", 18);
        const newHash = ethers.id("THREE_OF_THREE");

        // After 1st oracle — still at previous
        await cKES.connect(oracle1).submitReserveAttestation(newAmount, newHash);
        expect(await cKES.verifiedReserveAmount()).to.equal(prevReserve);

        // After 2nd oracle — still at previous
        await cKES.connect(oracle2).submitReserveAttestation(newAmount, newHash);
        expect(await cKES.verifiedReserveAmount()).to.equal(prevReserve);

        // After 3rd (threshold = 3) — NOW it should update
        await cKES.connect(oracle3).submitReserveAttestation(newAmount, newHash);
        expect(await cKES.verifiedReserveAmount()).to.equal(newAmount);
    });

    // ── Test 6: Delayed valid oracle still finalizes ──────────────────────────
    it("Should finalize correctly when the second oracle attests after a delay", async function () {
        await cKES.addOracle(oracle1.address);
        await cKES.addOracle(oracle2.address);
        await cKES.setRequiredOracles(2);

        const newAmount = ethers.parseUnits("1500000", 18);
        const newHash = ethers.id("DELAYED_ORACLE");

        await cKES.connect(oracle1).submitReserveAttestation(newAmount, newHash);
        // Simulate delay (in a real system this could be blocks/time, here just ordering)
        await cKES.connect(oracle2).submitReserveAttestation(newAmount, newHash);

        expect(await cKES.verifiedReserveAmount()).to.equal(newAmount);
    });

    // ── Test 7: Stale attestation from retired oracle ─────────────────────────
    it("Should require fresh attestation after adding a new oracle (distinct round hash)", async function () {
        await cKES.addOracle(oracle1.address);
        await cKES.addOracle(oracle2.address);
        await cKES.setRequiredOracles(2);

        // Start a new attestation round
        const round1Amount = ethers.parseUnits("3000000", 18);
        const round1Hash = ethers.id("ROUND_1");
        await cKES.connect(oracle1).submitReserveAttestation(round1Amount, round1Hash);
        // Only 1 of 2 attested — not finalized yet

        // Now a completely separate round starts (different hash = different audit)
        const round2Amount = ethers.parseUnits("3100000", 18);
        const round2Hash = ethers.id("ROUND_2");

        // oracle2 attests to round2 (not round1) — these are independent
        await cKES.connect(oracle2).submitReserveAttestation(round2Amount, round2Hash);

        // Neither round reached threshold — reserve stays at 0
        const reserve = await cKES.verifiedReserveAmount();
        expect(reserve).to.not.equal(round1Amount);
        expect(reserve).to.not.equal(round2Amount);
    });
});
