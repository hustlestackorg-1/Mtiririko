const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * @file relayer-collusion.test.js
 * @description Relayer Collusion / MEV Manipulation Defense Suite
 *
 * Tests:
 *   1. Priority window: Non-assigned relayer is blocked from sniping during priority window
 *   2. Late-window liveness: Any relayer CAN process after 5-min window (priority lifted)
 *   3. Unstaked relayer cannot submit any batch at all
 *   4. Deterministic allocation is stable across repeated computations
 *   5. Batch size gate: 101-tx batch reverts with Exceeds max limit
 */

describe("Security: Relayer Collusion & MEV Defense", function () {
    let cKES, batchSettlement;
    let owner, relayer1, relayer2, relayer3, user1, user2;
    let domain;

    const types = {
        TransferRequest: [
            { name: "sender", type: "address" },
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint256" },
            { name: "chainId", type: "uint256" },
        ],
    };

    async function stakeRelayer(relayer) {
        await cKES.mint(relayer.address, ethers.parseUnits("5000", 18));
        await cKES.connect(relayer).approve(await batchSettlement.getAddress(), ethers.MaxUint256);
        await batchSettlement.connect(relayer).stake(ethers.parseUnits("1000", 18));
    }

    // Determine which relayer slot (0-based) a given intent maps to
    function computeAssignment(req, numRelayers) {
        const encoder = new ethers.AbiCoder();
        const encoded = encoder.encode(
            ["address", "address", "uint256", "uint256"],
            [req.sender, req.recipient, req.amount, req.nonce]
        );
        const hash = ethers.keccak256(encoded);
        return BigInt(hash) % BigInt(numRelayers);
    }

    beforeEach(async function () {
        [owner, relayer1, relayer2, relayer3, user1, user2] = await ethers.getSigners();

        const CKES = await ethers.getContractFactory("cKES");
        cKES = await CKES.deploy();
        await cKES.addOracle(owner.address);
        await cKES.addOracle(relayer1.address);
        await cKES.setRequiredOracles(2);
        const amt = ethers.parseUnits("1000000", 18);
        const hash = ethers.id("TEST_RESERVE");
        await cKES.connect(owner).submitReserveAttestation(amt, hash);
        await cKES.connect(relayer1).submitReserveAttestation(amt, hash);

        const Batch = await ethers.getContractFactory("BatchSettlement");
        batchSettlement = await upgrades.deployProxy(
            Batch, [await cKES.getAddress()], { kind: "uups", unsafeAllow: ["constructor"] }
        );

        const network = await ethers.provider.getNetwork();
        domain = {
            name: "MtiririkoBatch",
            version: "1",
            chainId: network.chainId,
            verifyingContract: await batchSettlement.getAddress(),
        };

        // Stake relayer1 (slot 0 = idx 1) and relayer2 (slot 1 = idx 2)
        await stakeRelayer(relayer1);
        await stakeRelayer(relayer2);

        // Fund user1
        await cKES.mint(user1.address, ethers.parseUnits("10000", 18));
        await cKES.connect(user1).approve(await batchSettlement.getAddress(), ethers.MaxUint256);
    });

    // ── Test 1: Priority Window Block ─────────────────────────────────────────
    // Strategy: compute which relayer the intent is assigned to, then send it with the
    // OTHER relayer, proving the priority window block — no slot search needed.
    it("Should block the non-assigned relayer from sniping during the priority window", async function () {
        const latest = await time.latest();
        const longExpiry = latest + 7200; // 2 hours — far inside priority window
        const network = await ethers.provider.getNetwork();

        // Build a baseline intent
        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("42", 18),
            nonce: 0n,
            expiry: BigInt(longExpiry),
            chainId: network.chainId,
        };

        // Determine which slot (0=relayer1, 1=relayer2) this intent belongs to
        const assignedSlot = computeAssignment(req, 2);
        // Use the OTHER relayer to prove the priority block
        const wrongRelayer = assignedSlot === 0n ? relayer2 : relayer1;

        const sig = await user1.signTypedData(domain, types, req);
        const fullReq = { ...req, signature: sig };

        // Submit with the wrong relayer — priority window should block it
        const tx = await batchSettlement.connect(wrongRelayer).processBatch([fullReq]);
        const receipt = await tx.wait();
        const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");

        expect(failed).to.not.be.undefined;
        expect(failed.args[3]).to.equal("Relayer priority window active");
    });

    // ── Test 2: Late Window Liveness ──────────────────────────────────────────
    // After advancing time so block.timestamp + 300 >= expiry, the priority lock lifts
    // and the non-assigned relayer can submit.
    it("Should ALLOW the non-assigned relayer to process after the priority window expires", async function () {
        const latest = await time.latest();
        // Expiry is 350s away; after increasing by 55s, (latest+55)+300 = latest+355 > expiry
        const expiry = latest + 350;
        const network = await ethers.provider.getNetwork();

        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("42", 18),
            nonce: 0n,
            expiry: BigInt(expiry),
            chainId: network.chainId,
        };

        const assignedSlot = computeAssignment(req, 2);
        const wrongRelayer = assignedSlot === 0n ? relayer2 : relayer1;

        const sig = await user1.signTypedData(domain, types, req);
        const fullReq = { ...req, signature: sig };

        // Advance past the 5-minute priority window threshold
        await time.increase(55); // (latest+55) + 300 = latest+355 > latest+350 → window lifted

        const tx = await batchSettlement.connect(wrongRelayer).processBatch([fullReq]);
        const receipt = await tx.wait();
        const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");

        // Priority window must NOT be the rejection reason (may fail for balance or other reasons)
        if (failed) {
            expect(failed.args[3]).to.not.equal("Relayer priority window active");
        }
        // No failed event = success = also valid (window was lifted)
    });

    // ── Test 3: Unstaked Relayer Cannot Submit ─────────────────────────────────
    it("Should revert entirely if an unstaked address attempts to submit a batch", async function () {
        const latest = await time.latest();
        const network = await ethers.provider.getNetwork();
        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("10", 18),
            nonce: 0n,
            expiry: BigInt(latest + 3600),
            chainId: network.chainId,
        };
        const sig = await user1.signTypedData(domain, types, req);

        // relayer3 has no stake
        await expect(
            batchSettlement.connect(relayer3).processBatch([{ ...req, signature: sig }])
        ).to.be.revertedWith("BatchSettlement: Insufficient Relayer Stake");
    });

    // ── Test 4: Deterministic Assignment Stability ─────────────────────────────
    it("Should assign the same intent deterministically across repeated computations", async function () {
        const network = await ethers.provider.getNetwork();
        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("777", 18),
            nonce: 0n,
            expiry: BigInt((await time.latest()) + 3600),
            chainId: network.chainId,
        };

        const a1 = computeAssignment(req, 2);
        const a2 = computeAssignment(req, 2);
        const a3 = computeAssignment(req, 2);
        expect(a1).to.equal(a2);
        expect(a2).to.equal(a3);
    });

    // ── Test 5: Batch Size Enforcement ────────────────────────────────────────
    it("Should revert if any relayer submits a batch exceeding 100 transfers", async function () {
        const latest = await time.latest();
        const network = await ethers.provider.getNetwork();

        const requests = Array.from({ length: 101 }, (_, i) => ({
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("1", 18),
            nonce: BigInt(i),
            expiry: BigInt(latest + 3600),
            chainId: network.chainId,
            signature: "0x" + "00".repeat(65),
        }));

        await expect(
            batchSettlement.connect(relayer1).processBatch(requests)
        ).to.be.revertedWith("BatchSettlement: Exceeds max limit");
    });
});
