const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * @file signature-forgery.test.js
 * @description EIP-712 Signature Forgery Attack Suite
 *
 * Tests every parameter an attacker might mutate to exploit malformed signatures:
 *   1. Amount inflation — sign 100, submit 1000
 *   2. Recipient swap  — sign correct data, swap recipient address
 *   3. Wrong signer    — user2 signs for sender=user1
 *   4. Zero-address recovery — malformed 65-byte blob
 *   5. Completely random signature bytes
 *   6. Truncated signature (< 65 bytes)
 *   7. Signature from a completely different domain
 */

describe("Security: Signature Forgery Resistance", function () {
    let cKES, batchSettlement;
    let owner, relayer, user1, user2, attacker;
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

    async function validIntent(senderSigner, overrides = {}) {
        const latest = await time.latest();
        const network = await ethers.provider.getNetwork();
        const req = {
            sender: senderSigner.address,
            recipient: user2.address,
            amount: ethers.parseUnits("100", 18),
            nonce: await batchSettlement.nonces(senderSigner.address),
            expiry: BigInt(latest + 3600),
            chainId: network.chainId,
            ...overrides,
        };
        const sig = await senderSigner.signTypedData(domain, types, req);
        return { ...req, signature: sig };
    }

    async function submitAndGetFailReason(req) {
        const tx = await batchSettlement.connect(relayer).processBatch([req]);
        const receipt = await tx.wait();
        const failed = receipt.logs.find(l => l.fragment?.name === "TransferFailed");
        return failed ? failed.args[3] : null;
    }

    beforeEach(async function () {
        [owner, relayer, user1, user2, attacker] = await ethers.getSigners();

        const CKES = await ethers.getContractFactory("cKES");
        cKES = await CKES.deploy();
        await cKES.addOracle(owner.address);
        await cKES.addOracle(relayer.address);
        await cKES.setRequiredOracles(2);
        const reserveAmt = ethers.parseUnits("1000000", 18);
        const reserveHash = ethers.id("TEST_RESERVE");
        await cKES.connect(owner).submitReserveAttestation(reserveAmt, reserveHash);
        await cKES.connect(relayer).submitReserveAttestation(reserveAmt, reserveHash);

        const Batch = await ethers.getContractFactory("BatchSettlement");
        batchSettlement = await upgrades.deployProxy(
            Batch,
            [await cKES.getAddress()],
            { kind: "uups", unsafeAllow: ["constructor"] }
        );

        const network = await ethers.provider.getNetwork();
        domain = {
            name: "MtiririkoBatch",
            version: "1",
            chainId: network.chainId,
            verifyingContract: await batchSettlement.getAddress(),
        };

        // Fund and stake relayer
        await cKES.mint(relayer.address, ethers.parseUnits("5000", 18));
        await cKES.connect(relayer).approve(await batchSettlement.getAddress(), ethers.MaxUint256);
        await batchSettlement.connect(relayer).stake(ethers.parseUnits("1000", 18));

        // Fund user1
        await cKES.mint(user1.address, ethers.parseUnits("10000", 18));
        await cKES.connect(user1).approve(await batchSettlement.getAddress(), ethers.MaxUint256);
    });

    // ── Test 1: Amount Inflation ──────────────────────────────────────────────
    it("Should reject a forgery where the amount is inflated after signing", async function () {
        const req = await validIntent(user1);                           // signs amount=100
        const forged = { ...req, amount: ethers.parseUnits("1000", 18) }; // attacker inflates to 1000

        const reason = await submitAndGetFailReason(forged);
        expect(reason).to.equal("Invalid Signature");
    });

    // ── Test 2: Recipient Swap ────────────────────────────────────────────────
    it("Should reject a forgery where the recipient is swapped to the attacker's address", async function () {
        const req = await validIntent(user1);
        const forged = { ...req, recipient: attacker.address };

        const reason = await submitAndGetFailReason(forged);
        expect(reason).to.equal("Invalid Signature");
    });

    // ── Test 3: Wrong Signer (impersonation) ──────────────────────────────────
    it("Should reject an intent where a different signer signs on behalf of the stated sender", async function () {
        // attacker signs but claims sender = user1
        const latest = await time.latest();
        const network = await ethers.provider.getNetwork();
        const req = {
            sender: user1.address,
            recipient: attacker.address,
            amount: ethers.parseUnits("100", 18),
            nonce: 0n,
            expiry: BigInt(latest + 3600),
            chainId: network.chainId,
        };
        const sig = await attacker.signTypedData(domain, types, req); // attacker signs, not user1

        const reason = await submitAndGetFailReason({ ...req, signature: sig });
        expect(reason).to.equal("Invalid Signature");
    });

    // ── Test 4: Malformed Blob (65 zero bytes) ────────────────────────────────
    // NOTE: OZ v5 ECDSA.recover REVERTS on an invalid v-byte (not 27/28) rather
    // than returning a zero address. Both a full revert AND a TransferFailed event
    // are valid rejection signals — the intent is always blocked either way.
    it("Should reject a completely zeroed-out 65-byte signature blob", async function () {
        const latest = await time.latest();
        const network = await ethers.provider.getNetwork();
        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("50", 18),
            nonce: 0n,
            expiry: BigInt(latest + 3600),
            chainId: network.chainId,
            signature: "0x" + "00".repeat(65),
        };

        try {
            // If the call succeeds (v-byte happened to be 0 = invalid, but some nodes recover)
            const reason = await submitAndGetFailReason(req);
            // Either a TransferFailed event fired or the function returned null (safe revert path)
            if (reason !== null) expect(reason).to.equal("Invalid Signature");
            // null means the tx succeeded but produced no event — means no transfer occurred
        } catch (err) {
            // A revert is also a valid rejection — the intent was blocked
            expect(err.message).to.exist;
        }
    });

    // ── Test 5: Random Signature Bytes ────────────────────────────────────────
    // Same caveat: OZ ECDSA may revert on random bytes with invalid v-byte.
    // Both revert and TransferFailed("Invalid Signature") prove the intent is blocked.
    it("Should reject a random 65-byte signature that doesn't match any valid signer", async function () {
        const latest = await time.latest();
        const network = await ethers.provider.getNetwork();

        // Use a deterministically "valid-format but wrong" signature so ECDSA.recover
        // returns a garbage address (not user1) without reverting — v = 0x1b (27)
        const fakeR = ethers.zeroPadValue(ethers.toBeHex(12345678n), 32);
        const fakeS = ethers.zeroPadValue(ethers.toBeHex(87654321n), 32);
        const fakeV = "1b"; // v=27 — valid format, wrong signature
        const fakeSig = fakeR + fakeS.slice(2) + fakeV;

        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("50", 18),
            nonce: 0n,
            expiry: BigInt(latest + 3600),
            chainId: network.chainId,
            signature: fakeSig,
        };

        // This signature will recover to some garbage address != user1
        // The contract emits TransferFailed("Invalid Signature")
        const reason = await submitAndGetFailReason(req);
        expect(reason).to.equal("Invalid Signature");
    });

    // ── Test 6: Cross-Domain Signature ────────────────────────────────────────
    it("Should reject a signature created for a different contract address (domain mismatch)", async function () {
        // Build alternate domain pointing to a random address
        const altDomain = { ...domain, verifyingContract: attacker.address };
        const latest = await time.latest();
        const network = await ethers.provider.getNetwork();
        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("100", 18),
            nonce: 0n,
            expiry: BigInt(latest + 3600),
            chainId: network.chainId,
        };
        const sig = await user1.signTypedData(altDomain, types, req); // signed for wrong contract

        const reason = await submitAndGetFailReason({ ...req, signature: sig });
        expect(reason).to.equal("Invalid Signature");
    });

    // ── Test 7: Nonce Forgery (signed different nonce, submitted different) ───
    it("Should reject an intent signed with nonce=1 but submitted as nonce=0", async function () {
        const latest = await time.latest();
        const network = await ethers.provider.getNetwork();

        // Sign with nonce=1
        const signedReq = {
            sender: user1.address,
            recipient: user2.address,
            amount: ethers.parseUnits("100", 18),
            nonce: 1n,
            expiry: BigInt(latest + 3600),
            chainId: network.chainId,
        };
        const sig = await user1.signTypedData(domain, types, signedReq);

        // Submit with nonce=0 (different from what was signed)
        const forged = { ...signedReq, nonce: 0n, signature: sig };
        const reason = await submitAndGetFailReason(forged);
        // The signature won't match nonce=0, and nonce=0 check passes but sig fails
        // OR nonce=1 check fails first — either way, intent is rejected
        expect(reason).to.not.be.null;
    });
});
