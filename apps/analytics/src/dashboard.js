const express = require("express");
const path = require("path");
const { Parser } = require("json2csv");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

function generateMockTransactions() {
    let txs = [];
    for (let i = 0; i < 20; i++) {
        let isAnomaly = Math.random() > 0.85;
        let amount = isAnomaly ? Math.floor(Math.random() * 500000) + 1000001 : Math.floor(Math.random() * 50000) + 50;
        txs.push({
            txId: "0x" + Math.random().toString(16).slice(2, 66).padEnd(64, '0'),
            senderHash: "0x" + Math.random().toString(16).slice(2, 66).padEnd(64, '0'),
            amount: amount,
            timestamp: Date.now() - Math.floor(Math.random() * 10000000),
            locationData: "Nairobi - CBD"
        });
    }
    txs.sort((a, b) => b.timestamp - a.timestamp);
    return txs;
}

const mockTxs = generateMockTransactions();
const totalVolumeAggr = mockTxs.reduce((sum, t) => sum + t.amount, 0);

app.get("/", (req, res) => {
    res.render("index", {
        transactions: mockTxs,
        totalVolume: totalVolumeAggr,
        anomalies: mockTxs.filter(t => t.amount > 1000000)
    });
});

app.get("/api/csv", (req, res) => {
    try {
        const fields = ['txId', 'senderHash', 'amount', 'timestamp', 'locationData'];
        const opts = { fields };
        const parser = new Parser(opts);
        const csv = parser.parse(mockTxs);
        res.header('Content-Type', 'text/csv');
        res.attachment('mtiririko_pilot_metrics.csv');
        return res.send(csv);
    } catch (err) {
        console.error("CSV Export Error:", err);
        res.status(500).send("Error exporting CSV");
    }
});

const PORT = 4000;
app.listen(PORT, '0.0.0.0', () => console.log(`Analytics Dashboard live on port ${PORT}`));
