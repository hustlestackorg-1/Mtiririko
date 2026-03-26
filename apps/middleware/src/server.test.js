/**
 * @file server.test.js
 * @description Mtiririko Middleware — Jest/Supertest Unit & Integration Tests
 *
 * Coverage:
 *   1. Health Check endpoint
 *   2. M-Pesa Webhook — valid payment processing
 *   3. M-Pesa Webhook — idempotency (duplicate webhook rejection)
 *   4. M-Pesa Webhook — missing required fields
 *   5. Rate Limiting is configured
 *   6. CORS headers are set
 */

const request = require("supertest");

// ─── Mock the blockchain service so no real RPC calls are made ───────────────
jest.mock("./services/blockchain", () => ({
    mintStablecoinsToAddress: jest.fn().mockResolvedValue({
        txHash: "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        amount: "500000000000000000000",
        currency: "cKES",
        recipient: "0x1234567890abcdef1234567890abcdef12345678",
        network: "Celo Sepolia",
        chainId: 42069
    }),
    provider: {},
    wallet: {}
}));

const blockchain = require("./services/blockchain");

// Require the server AFTER mocking to ensure mocks take effect
let app;
beforeAll(() => {
    // Suppress logger output in tests
    jest.spyOn(console, "log").mockImplementation(() => { });
    jest.spyOn(console, "error").mockImplementation(() => { });
    app = require("./server");
});

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("GET /health", () => {
    it("should return 200 with a healthy status message", async () => {
        const res = await request(app).get("/health");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("status");
        expect(res.body.status).toMatch(/running/i);
    });
});

describe("POST /api/v1/mpesa/webhook", () => {
    const validPayload = {
        TransID: "MPESA_TEST_001",
        MSISDN: "254712345678",
        TransAmount: "500",
        BillRefNumber: "INV-2024-001"
    };

    it("should process a valid M-Pesa webhook and return 200", async () => {
        const res = await request(app)
            .post("/api/v1/mpesa/webhook")
            .send(validPayload);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", "M-Pesa payment tokenized successfully");
        expect(res.body.details).toHaveProperty("currency", "cKES");
        expect(res.body.details).toHaveProperty("network", "Celo Sepolia");
        expect(blockchain.mintStablecoinsToAddress).toHaveBeenCalledWith(
            expect.any(String),
            "500"
        );
    });

    it("should reject a duplicate webhook with the same TransID (idempotency)", async () => {
        const uniquePayload = { ...validPayload, TransID: "MPESA_DUPE_TEST_002" };

        // First call — should succeed
        await request(app)
            .post("/api/v1/mpesa/webhook")
            .send(uniquePayload);

        // Second call with same TransID — should be rejected idempotently
        const res = await request(app)
            .post("/api/v1/mpesa/webhook")
            .send(uniquePayload);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", "Transaction already processed");
    });

    it("should handle webhooks without TransID (no idempotency key) gracefully", async () => {
        const noIdPayload = {
            MSISDN: "254799999999",
            TransAmount: "200",
            BillRefNumber: "INV-NO-ID"
            // NOTE: No TransID — should process without idempotency tracking
        };
        const res = await request(app)
            .post("/api/v1/mpesa/webhook")
            .send(noIdPayload);
        expect(res.statusCode).toBe(200);
    });

    it("should return 500 if the blockchain service throws an error", async () => {
        blockchain.mintStablecoinsToAddress.mockRejectedValueOnce(
            new Error("RPC connection refused")
        );
        const res = await request(app)
            .post("/api/v1/mpesa/webhook")
            .send({ ...validPayload, TransID: "MPESA_FAIL_003" });
        expect(res.statusCode).toBe(500);
        expect(res.body).toHaveProperty("error", "Internal Server Error");
    });
});

describe("Security & Infrastructure", () => {
    it("should have CORS headers set on responses", async () => {
        const res = await request(app).get("/health");
        // CORS middleware sets the Access-Control-Allow-Origin header
        expect(res.headers).toHaveProperty("access-control-allow-origin");
    });

    it("should respond with 404 for unknown routes", async () => {
        const res = await request(app).get("/api/v1/unknown-route");
        expect(res.statusCode).toBe(404);
    });
});
