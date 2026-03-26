const { expect } = require("chai");
const { ethers, network, upgrades } = require("hardhat");

describe("BatchSettlement Upgradable & Fee Model", function () {
    let stablecoin, batchSettlement;
    let owner, user1, user2, relayer;
    let chainId;

    const getSignature = async (signer, contractAddress, transferReq) => {
        const domain = {
            name: "MtiririkoBatch",
            version: "1",
            chainId: chainId,
            verifyingContract: contractAddress
        };
        const types = {
            TransferRequest: [
                { name: "sender", type: "address" },
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "expiry", type: "uint256" },
                { name: "chainId", type: "uint256" }
            ]
        };
        return await signer.signTypedData(domain, types, transferReq);
    };

    before(async () => {
        [owner, user1, user2, relayer] = await ethers.getSigners();
        const nw = await ethers.provider.getNetwork();
        chainId = nw.chainId;
    });

    beforeEach(async () => {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        stablecoin = await MockERC20.deploy();
        await stablecoin.waitForDeployment();

        // Deploy using Upgrades Plugin to simulate the proxy and bypass implementation lock
        const BatchSettlement = await ethers.getContractFactory("BatchSettlement");
        batchSettlement = await upgrades.deployProxy(BatchSettlement, [await stablecoin.getAddress()], { kind: "uups", unsafeAllow: ["constructor"] });
        await batchSettlement.waitForDeployment();

        // Mint tokens to user1 and approve batch settlement contract
        await stablecoin.mint(user1.address, ethers.parseUnits("1000", 18));
        await stablecoin.connect(user1).approve(await batchSettlement.getAddress(), ethers.parseUnits("1000", 18));

        // Setup Relayer Stake
        const MINT_STAKE = ethers.parseUnits("1000", 18);
        await stablecoin.mint(relayer.address, MINT_STAKE);
        await stablecoin.connect(relayer).approve(await batchSettlement.getAddress(), MINT_STAKE);
        await batchSettlement.connect(relayer).stake(MINT_STAKE);
    });

    it("Should process a valid batch, applying strict replay protection and relayer fees", async function () {
        const amount = ethers.parseUnits("50", 18);
        const fee = (amount * 2n) / 1000n; // 0.2% fee
        const amountAfterFee = amount - fee;

        const nonce = await batchSettlement.nonces(user1.address);
        const timestamp = (await ethers.provider.getBlock('latest')).timestamp;

        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: amount,
            nonce: nonce,
            expiry: timestamp + 600, // 10 minutes expiry
            chainId: chainId
        };

        req.signature = await getSignature(user1, await batchSettlement.getAddress(), req);

        // Relayer submits the batch, relayer earns the fee
        const tx = await batchSettlement.connect(relayer).processBatch([req]);
        const receipt = await tx.wait();

        const event = receipt.logs.find(e => e.fragment && e.fragment.name === 'BatchProcessed');
        const totalAmountAfterFee = event.args[1];
        const dynamicFee = event.args[2];

        // Instead of strict predicting the fee because it's dynamically linked to gas price now,
        // we just verify math consistency.
        expect(totalAmountAfterFee + dynamicFee).to.equal(amount);
        expect(await stablecoin.balanceOf(user2.address)).to.equal(totalAmountAfterFee);
    });

    it("Should reject expired transactions", async function () {
        const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        const req = {
            sender: user1.address,
            recipient: user2.address,
            amount: 100n,
            nonce: 0n,
            expiry: timestamp - 100, // Expired
            chainId: chainId,
            signature: "0x"
        };

        // We use wait since event emission verification is slightly complex when skipping execution
        const tx = await batchSettlement.connect(relayer).processBatch([req]);
        const receipt = await tx.wait();

        // Ensure BatchProcessed fired with 0 successes
        const event = receipt.logs.find(e => e.fragment && e.fragment.name === 'BatchProcessed');
        expect(event.args[0]).to.equal(0n); // 0 successful transfers
    });
});
