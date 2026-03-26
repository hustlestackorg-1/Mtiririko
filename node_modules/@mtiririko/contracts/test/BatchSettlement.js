const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchSettlement", function () {
    let MockERC20, stablecoin;
    let BatchSettlement, batchSettlement;
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
                { name: "nonce", type: "uint256" }
            ]
        };
        return await signer.signTypedData(domain, types, transferReq);
    };

    before(async () => {
        [owner, user1, user2, relayer] = await ethers.getSigners();
        const network = await ethers.provider.getNetwork();
        chainId = network.chainId;
    });

    beforeEach(async () => {
        // 1. Deploy a Mock ERC20
        const ERC20Factory = await ethers.getContractFactory("contracts/MicroTransaction.sol:MicroTransaction");
        // Wait, MicroTransaction isn't an ERC20. We will use an OpenZeppelin ERC20Mock if possible, 
        // or we'll deploy a quick custom MockERC20 first inside the test or use ethers to stub.

        // Instead of Mocking, let's deploy a standard ERC20 directly
        const MockToken = await ethers.getContractFactory(
            [
                "constructor()",
                "function mint(address account, uint256 amount) public",
                "function transferFrom(address sender, address recipient, uint256 amount) public returns (bool)",
                "function approve(address spender, uint256 amount) public returns (bool)",
                "function balanceOf(address account) public view returns (uint256)"
            ],
            "require('@openzeppelin/contracts/token/ERC20/ERC20.sol'); contract MockERC20 is ERC20 { constructor() ERC20('MockToken', 'MTK') {} function mint(address account, uint256 amount) public { _mint(account, amount); } }"
        );
        // Since compiling dynamically is hard, let's just write a mock ERC20 in contracts/mocks/MockERC20.sol 
    });
});
