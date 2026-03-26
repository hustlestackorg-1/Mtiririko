const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * @file replay-attack.test.js
 * @description Replay Attack Suite
 *
 * Tests:
 *   1. Nonce reuse → rejected with "Invalid nonce"
 *   2. Expired intent resubmission → rejected with "Transaction expired"
 *   3. Cross-chain replay (wrong chainId in signed struct) → "Invalid chain ID"
 *   4. Timestamp manipulation (sign far-future expiry, advance clock) → rejected
 *   5. Old-intent reuse after nonce has advanced → rejected
 */

describe("Security: Replay Attack Resistance", function () {
    let cKES, batchSettlement;
    let owner, relayer, user1, user2;

    // EIP-712 typed data helpers
    let domain, types;

    async function buildDomain() {
        const network = await ethers.provider.getNetwork();
        return {
            name: "MtiririkoBatch",
            version: "1",
            chainId: network.chainId,
            verifyingContract: await batchSettlement.getAddress(),
        };
    }

    const transferTypes = {
        TransferRequest: [
            { name: "sender", type: "address" },
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint256" },
            { name: "chainId", type: "uint256" },
        ],
    };

    async function signRequest(signer, req) {
        const sig = await signer.signTypedData(domain, transferTypes, req);
        return sig;
    }

    async function makeIntent(overrides = {}) {
        const latest = await time.latest();
        const base = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("100", 18),
            nonce: 0n,
            expiry: BigInt(latest + 3600),
            chainId: domain.chainId,
        };
        return { ...base, ...overrides };
    }

    beforeEach(async function () {
        [owner, relayer, user1, user2] = await ethers.getSigners();

        // Deploy cKES
        const CKES = await ethers.getContractFactory("cKES");
        cKES = await CKES.deploy();

        // Setup M-of-N oracle attestation
        await cKES.addOracle(owner.address);
        await cKES.addOracle(relayer.address);
        await cKES.setRequiredOracles(2);
        const amount = ethers.parseUnits("1000000", 18);
        const hash = ethers.id("TEST_RESERVE");
        await cKES.connect(owner).submitReserveAttestation(amount, hash);
        await cKES.connect(relayer).submitReserveAttestation(amount, hash);

        // Deploy BatchSettlement
        const Batch = await ethers.getContractFactory("BatchSettlement");
        batchSettlement = await upgrades.deployProxy(
            Batch,
            [await cKES.getAddress()],
            { kind: "uups", unsafeAllow: ["constructor"] }
        );

        domain = await buildDomain();

        // Fund relayer and stake
        await cKES.mint(relayer.address, ethers.parseUnits("5000", 18));
        await cKES.connect(relayer).approve(await batchSettlement.getAddress(), ethers.MaxUint256);
        await batchSettlement.connect(relayer).stake(ethers.parseUnits("1000", 18));

        // Fund user1 for transfers
        await cKES.mint(user1.address, ethers.parseUnits("10000", 18));
        await cKES.connect(user1).approve(await batchSettlement.getAddress(), ethers.MaxUint256);
    });

    // ── Test 1: Nonce Reuse ──────────────────────────────────────────────────
    describe("Nonce Reuse (Classic Replay)", function () {
        it("Should reject a second submission with the same nonce after first succeeds", async function () {
            const req = await makeIntent({ nonce: 0n });
            const sig = await signRequest(user1, req);
            const fullReq = { ...req, signature: sig };

            // First submission — should succeed silently (nonce advances to 1)
            const tx1 = await batchSettlement.connect(relayer).processBatch([fullReq]);
            const receipt1 = await tx1.wait();
            const success = receipt1.logs.find(l => l.fragment?.name === "BatchProcessed");
            expect(success).to.not.be.undefined;

            // Nonce on-chain is now 1 — submitting nonce=0 again is a replay
            const tx2 = await batchSettlement.connect(relayer).processBatch([fullReq]);
            const receipt2 = await tx2.wait();
            const failed = receipt2.logs.find(l => l.fragment?.name === "TransferFailed");
            expect(failed).to.not.be.undefined;
            expect(failed.args[3]).to.equal("Invalid nonce");
        });

        it("Should reject intent with a nonce far ahead of the current sequence", async function () {
            // user1 nonce is 0. Submitting nonce=5 should immediately fail.
            const req = await makeIntent({ nonce: 5n });
            const sig = await signRequest(user1, req);

            const tx = await batchSettlement.connect(relayer).processBatch([{ ...req, signature: sig }]);
            const receipt = await tx.wait();
            const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");
            expect(failed).to.not.be.undefined;
            expect(failed.args[3]).to.equal("Invalid nonce");
        });
    });

    // ── Test 2: Expired Intent Resubmission ───────────────────────────────────
    describe("Expired Intent Resubmission", function () {
        it("Should reject an intent that was signed with a past expiry", async function () {
            const latest = await time.latest();
            // Sign with expiry 60 seconds IN THE PAST
            const req = await makeIntent({ expiry: BigInt(latest - 60) });
            const sig = await signRequest(user1, req);

            const tx = await batchSettlement.connect(relayer).processBatch([{ ...req, signature: sig }]);
            const receipt = await tx.wait();
            const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");
            expect(failed).to.not.be.undefined;
            expect(failed.args[3]).to.equal("Transaction expired");
        });

        it("Should reject a valid intent once the clock advances past its expiry", async function () {
            // Sign with expiry 5 minutes from now
            const latest = await time.latest();
            const req = await makeIntent({ expiry: BigInt(latest + 300) });
            const sig = await signRequest(user1, req);

            // Advance time by 6 minutes (past the 5-minute window)
            await time.increase(360);

            const tx = await batchSettlement.connect(relayer).processBatch([{ ...req, signature: sig }]);
            const receipt = await tx.wait();
            const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");
            expect(failed).to.not.be.undefined;
            expect(failed.args[3]).to.equal("Transaction expired");
        });
    });

    // ── Test 3: Cross-Chain Replay ────────────────────────────────────────────
    describe("Cross-Chain Replay (Wrong chainId)", function () {
        it("Should reject a signed intent with a mismatched chainId", async function () {
            // Sign with a foreign chain ID (e.g., Ethereum mainnet = 1)
            const req = await makeIntent({ chainId: 1n });
            const sig = await signRequest(user1, req);

            const tx = await batchSettlement.connect(relayer).processBatch([{ ...req, signature: sig }]);
            const receipt = await tx.wait();
            const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");
            expect(failed).to.not.be.undefined;
            // An intent with wrong chainId will fail signature check (EIP-712 domain includes chainId)
            // or the explicit chainId guard — both catch it
            expect(["Invalid chain ID", "Invalid Signature"]).to.include(failed.args[3]);
        });

        it("Should reject an intent with chainId = 0 (malformed/unsigned)", async function () {
            const req = await makeIntent({ chainId: 0n });
            const sig = await signRequest(user1, req);

            const tx = await batchSettlement.connect(relayer).processBatch([{ ...req, signature: sig }]);
            const receipt = await tx.wait();
            const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");
            expect(failed).to.not.be.undefined;
        });
    });

    // ── Test 4: Old Intent After Nonce Advances ───────────────────────────────
    describe("Old Intent After Nonce Advances", function () {
        it("Should reject an old nonce=0 intent after user1's nonce has already advanced", async function () {
            // Store the old nonce=0 signed intent
            const oldReq = await makeIntent({ nonce: 0n });
            const oldSig = await signRequest(user1, oldReq);

            // Process a DIFFERENT intent first so the nonce advances to 1
            const freshReq = await makeIntent({ nonce: 0n, amount: ethers.parseUnits("1", 18) });
            const freshSig = await signRequest(user1, freshReq);
            await batchSettlement.connect(relayer).processBatch([{ ...freshReq, signature: freshSig }]);
            expect(await batchSettlement.nonces(user1.address)).to.equal(1n);

            // Now try to replay the first old-nonce intent
            const tx = await batchSettlement.connect(relayer).processBatch([{ ...oldReq, signature: oldSig }]);
            const receipt = await tx.wait();
            const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");
            expect(failed).to.not.be.undefined;
            expect(failed.args[3]).to.equal("Invalid nonce");
        });
    });
});
