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

function parseCsvLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];

        if (ch === '"') {
            const next = line[i + 1];
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === "," && !inQuotes) {
            values.push(current.trim());
            current = "";
            continue;
        }

        current += ch;
    }

    values.push(current.trim());
    return values;
}

fs.mkdirSync("uploads", { recursive: true });
const upload = multer({ dest: "uploads/" });

app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "money-muling-backend" });
});

app.post("/analyze", upload.single("file"), (req, res) => {
    const startTime = Date.now();
    let uploadedPath = null;

    try {
        console.log("Received /analyze request");

        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded. Use form field 'file'." });
        }

        uploadedPath = req.file.path;
        const raw = fs.readFileSync(uploadedPath, "utf8");
        const lines = raw
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

        if (lines.length < 2) {
            return res.status(400).json({ error: "CSV must include a header row and at least one transaction row." });
        }

        const headers = parseCsvLine(lines[0]).map(h => h.trim());
        const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/\s+/g, "_"));
        const senderCandidates = ["sender_id", "sender", "from", "source_account", "source"];
        const receiverCandidates = ["receiver_id", "receiver", "to", "destination_account", "destination"];
        const senderIndex = normalizedHeaders.findIndex(h => senderCandidates.includes(h));
        const receiverIndex = normalizedHeaders.findIndex(h => receiverCandidates.includes(h));

        if (senderIndex === -1 || receiverIndex === -1) {
            return res.status(400).json({
                error: "CSV must contain sender and receiver columns (e.g. sender_id, receiver_id)."
            });
        }

        const transactions = lines.slice(1).map(row => {
            const values = parseCsvLine(row).map(v => v.trim());
            return {
                sender_id: values[senderIndex] || "",
                receiver_id: values[receiverIndex] || ""
            };
        }).filter(tx => tx.sender_id && tx.receiver_id);

        if (transactions.length === 0) {
            return res.status(400).json({
                error: "No valid transactions found. Ensure sender and receiver values are present."
            });
        }

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

        console.log(
            `Analysis done: ${transactions.length} tx, ${suspicious_accounts.length} suspicious, ${rings.length} rings`
        );
        return res.json(response);
    } catch (error) {
        console.error("Analyze failed:", error);
        return res.status(500).json({ error: "Analysis failed. Check CSV format and try again." });
    } finally {
