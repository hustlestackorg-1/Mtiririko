import { ethers } from "ethers";
import {
    CONTRACT_ADDRESS, CONTRACT_ABI,
    ABIGAIL_PK, MERCY_PK, VICTOR_PK, SARAH_PK, MERCHANT_PK
} from './contract.js';

// Setup Blockchain Connection
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const abigailWallet = new ethers.Wallet(ABIGAIL_PK, provider);
const mercyWallet = new ethers.Wallet(MERCY_PK, provider);
const victorWallet = new ethers.Wallet(VICTOR_PK, provider);
const sarahWallet = new ethers.Wallet(SARAH_PK, provider);
const merchantWallet = new ethers.Wallet(MERCHANT_PK, provider);

// Contract Instances
const abigailContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, abigailWallet);
const mercyContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, mercyWallet);
const victorContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, victorWallet);
const sarahContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, sarahWallet);
const merchantContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, merchantWallet);

const getShortId = (wallet) => wallet.address.substring(0, 6) + '...' + wallet.address.substring(38);

export const wallets = { abigail: abigailWallet, mercy: mercyWallet, victor: victorWallet, sarah: sarahWallet, merchant: merchantWallet };
export const contracts = { abigail: abigailContract, mercy: mercyContract, victor: victorContract, sarah: sarahContract, merchant: merchantContract };

export const state = {
    activeId: 'abigail',
    accounts: {
        abigail: {
            user: { name: 'Abigail Njeri', initials: 'AN', phone: '+254 712 345 678', walletId: getShortId(abigailWallet), rawAddress: abigailWallet.address },
            balance: 0,
            recent: [],
            monthlyIncome: 0,
            monthlySpent: 0,
            spending: [120, 300, 150, 400, 200, 0]
        },
        mercy: {
            user: { name: 'Mercy Wanjiku', initials: 'MW', phone: '+254 756 123 456', walletId: getShortId(mercyWallet), rawAddress: mercyWallet.address },
            balance: 0,
            recent: [],
            monthlyIncome: 0,
            monthlySpent: 0,
            spending: [50, 80, 100, 20, 60, 0]
        },
        victor: {
            user: { name: 'Victor Kiptoo', initials: 'VK', phone: '+254 777 888 999', walletId: getShortId(victorWallet), rawAddress: victorWallet.address },
            balance: 0,
            recent: [],
            monthlyIncome: 0,
            monthlySpent: 0,
            spending: [0, 0, 0, 0, 0, 0]
        },
        sarah: {
            user: { name: 'Sarah Ochieng', initials: 'SO', phone: '+254 711 222 333', walletId: getShortId(sarahWallet), rawAddress: sarahWallet.address },
            balance: 0,
            recent: [],
            monthlyIncome: 0,
            monthlySpent: 0,
            spending: [0, 0, 0, 0, 0, 0]
        },
        merchant: {
            user: { name: 'Safaricom Agent', initials: 'SA', phone: '+254 700 000 000', walletId: getShortId(merchantWallet), rawAddress: merchantWallet.address },
            balance: 0,
            recent: [],
            monthlyIncome: 0,
            monthlySpent: 0,
            spending: [0, 0, 0, 0, 0, 0]
        }
    },

    get user() { return this.accounts[this.activeId].user; },
    get balance() { return this.accounts[this.activeId].balance; },
    set balance(val) { this.accounts[this.activeId].balance = val; },
    get recent() { return this.accounts[this.activeId].recent; },
    get monthlyIncome() { return this.accounts[this.activeId].monthlyIncome; },
    get monthlySpent() { return this.accounts[this.activeId].monthlySpent; },
    get spending() { return this.accounts[this.activeId].spending; },

    quickSend: [
        { name: 'Mercy W.', cId: 'mercy', initials: 'MW', hue: 280, last: 'Last sent: cKES 500', active: false },
        { name: 'Victor K.', cId: 'victor', initials: 'VK', hue: 210, last: 'Last sent: cKES 1,200', active: false },
        { name: 'Sarah O.', cId: 'sarah', initials: 'SO', hue: 340, last: 'Last sent: cKES 200', active: false },
        { name: 'Safaricom Agent', cId: 'merchant', initials: 'SA', hue: 150, last: 'Last sent: cKES 4,500', active: false }
    ]
};

// Formatter
export function fmt(number) {
    return new Intl.NumberFormat('en-KE').format(number);
}

export function calcFee(amount) {
    const fee = amount * 0.005; // 0.5% fee
    return { fee };
}

// ==========================================
// BLOCKCHAIN SYNC ENGINE
// ==========================================

export async function syncBalances() {
    try {
        const decimals = await abigailContract.decimals();

        // Fetch directly from Hardhat local node for all accounts
        for (const accountId of Object.keys(contracts)) {
            const raw = await contracts[accountId].balanceOf(wallets[accountId].address);
            state.accounts[accountId].balance = parseFloat(ethers.formatUnits(raw, decimals));
        }

        // Force UI re-render if we are on home or send
        if (window.location.hash === '#home' || window.location.hash === '') {
            const { renderHome } = await import('./views/Home.js');
            renderHome();
        }
    } catch (err) {
        console.error("Blockchain Sync Failed:", err);
    }
}

// Initial Sync On Load
setTimeout(syncBalances, 500);

export async function executeTransaction(amount, targetId) {
    try {
        const decimals = await abigailContract.decimals();
        const amountToTransfer = ethers.parseUnits(amount.toString(), decimals);

        const senderId = state.activeId;
        const receiverId = targetId;

        const contractToUse = contracts[senderId];
        const targetAddress = wallets[receiverId].address;

        // ACTUALLY EXECUTE ON BLOCKCHAIN
        const tx = await contractToUse.transfer(targetAddress, amountToTransfer);
        await tx.wait(); // Wait for confirmation on the ledger

        // Transaction History Update
        const time = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

        // Sender gets a deduction record
        state.accounts[senderId].recent.unshift({
            name: state.accounts[receiverId].user.name,
            type: 'out',
            amount: amount,
            cat: 'Transfer',
            time: time
        });
        state.accounts[senderId].monthlySpent += amount;

        // Receiver gets an income record
        state.accounts[receiverId].recent.unshift({
            name: state.accounts[senderId].user.name,
            type: 'in',
            amount: amount,
            cat: 'Received',
            time: time
        });
        state.accounts[receiverId].monthlyIncome += amount;

        // Finally sync balances from chain to reflect the change visually
        await syncBalances();

        return true; // Success
    } catch (err) {
        console.error("Transaction failed on chain", err);
        return false;
    }
}

// ==========================================
// WITHDRAWAL ENGINE (OFF-RAMP SIMULATION)
// ==========================================
export async function executeWithdrawal(amount, method) {
    try {
        const decimals = await abigailContract.decimals();
        const amountToWithdraw = ethers.parseUnits(amount.toString(), decimals);

        let contractToUse = contracts[senderId];

        // Send tokens strictly back to the bridge / deployer to simulate off-ramp burn
        const tx = await contractToUse.transfer("0x000000000000000000000000000000000000dEaD", amountToWithdraw);
        await tx.wait(); // Wait for confirmation on the ledger

        const time = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

        state.accounts[senderId].recent.unshift({
            name: `${method} Withdrawal`,
            type: 'out',
            amount: amount,
            cat: 'Off-Ramp',
            time: time
        });
        state.accounts[senderId].monthlySpent += amount;

        await syncBalances();
        return true; // Success
    } catch (err) {
        console.error("Withdrawal failed on chain", err);
        return false;
    }
}

// ==========================================
// TOP-UP ENGINE (ON-RAMP SIMULATION)
// ==========================================
export async function executeTopUp(amount, method) {
    try {
        const decimals = await abigailContract.decimals();
        const amountToMint = ethers.parseUnits(amount.toString(), decimals);

        const currentId = state.activeId;
        const contractToUse = contracts[currentId];
        const targetAddress = wallets[currentId].address;

        // Directly mint tokens to the user to simulate M-Pesa depositing Fiat 1:1 for Crypto
        const tx = await contractToUse.mint(targetAddress, amountToMint);
        await tx.wait(); // Wait for confirmation on the ledger

        const time = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

        state.accounts[currentId].recent.unshift({
            name: `${method} Deposit`,
            type: 'in',
            amount: amount,
            cat: 'On-Ramp',
            time: time
        });
        state.accounts[currentId].monthlyIncome += amount;

        await syncBalances();
        return true; // Success
    } catch (err) {
        console.error("Top-Up failed on chain", err);
        return false;
    }
}
