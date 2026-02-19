const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");

const {
    buildGraph,
    detectCycles,
    detectFanPatterns,
    calculateSuspicion
} = require("./detection");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

app.post("/analyze", upload.single("file"), (req, res) => {

    const startTime = Date.now();

    const raw = fs.readFileSync(req.file.path, "utf8");
    const rows = raw.trim().split("\n");
    const headers = rows[0].split(",");

    const transactions = rows.slice(1).map(row => {
        const values = row.split(",");
        let obj = {};
        headers.forEach((h, i) => obj[h.trim()] = values[i].trim());
        return obj;
    });

    const { graph, velocityMap } = buildGraph(transactions);
    const rings = detectCycles(graph);
    const { fanIn, fanOut } = detectFanPatterns(transactions);

    const accounts = new Set();
    transactions.forEach(tx => {
        accounts.add(tx.sender_id);
        accounts.add(tx.receiver_id);
    });

    const suspicious_accounts = [];

    accounts.forEach(acc => {
        const result = calculateSuspicion(acc, rings, fanIn, fanOut, velocityMap);
        if (result) {
            suspicious_accounts.push({
                account_id: acc,
                ...result
            });
        }
    });

    suspicious_accounts.sort((a, b) => b.suspicion_score - a.suspicion_score);

    const response = {
        suspicious_accounts,
        fraud_rings: rings,
        summary: {
            total_accounts_analyzed: accounts.size,
            suspicious_accounts_flagged: suspicious_accounts.length,
            fraud_rings_detected: rings.length,
            processing_time_seconds: (Date.now() - startTime) / 1000
        }
    };

    res.json(response);
});

app.listen(5000, () => {
    console.log("🚀 Advanced Backend running at http://localhost:5000");
});
