const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const {
    buildGraph,
    detectCycles,
    detectFanPatterns,
    calculateSuspicion
} = require("./detection");

const app = express();

/* ==========================
   MIDDLEWARE
========================== */
app.use(cors());
app.use(express.json());

/* ==========================
   ENSURE UPLOAD FOLDER
========================== */
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

/* ==========================
   MULTER CONFIG
========================== */
const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

/* ==========================
   CSV PARSER
========================== */
function parseCsvLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (ch === '"') {
            const next = line[i + 1];
            if (inQuotes && next === '"') {
                current += '"';
                i++;
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

/* ==========================
   ROUTES
========================== */

// Health Check (IMPORTANT for Render)
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        service: "money-muling-backend"
    });
});

// Root route (avoid Render 404)
app.get("/", (req, res) => {
    res.send("🚀 Money Muling Detection Backend is Running");
});

// Analyze Route
app.post("/analyze", upload.single("file"), async (req, res) => {
    const startTime = Date.now();
    let uploadedPath = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                error: "No file uploaded. Use form field name 'file'."
            });
        }

        uploadedPath = req.file.path;

        const raw = fs.readFileSync(uploadedPath, "utf8");
        const lines = raw
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

        if (lines.length < 2) {
            return res.status(400).json({
                error: "CSV must include header and at least one transaction row."
            });
        }

        const headers = parseCsvLine(lines[0]);
        const normalizedHeaders = headers.map(h =>
            h.toLowerCase().replace(/\s+/g, "_")
        );

        const senderCols = ["sender_id", "sender", "from", "source"];
        const receiverCols = ["receiver_id", "receiver", "to", "destination"];

        const senderIndex = normalizedHeaders.findIndex(h =>
            senderCols.includes(h)
        );
        const receiverIndex = normalizedHeaders.findIndex(h =>
            receiverCols.includes(h)
        );

        if (senderIndex === -1 || receiverIndex === -1) {
            return res.status(400).json({
                error:
                    "CSV must contain sender and receiver columns (e.g. sender_id, receiver_id)."
            });
        }

        const transactions = lines
            .slice(1)
            .map(row => {
                const values = parseCsvLine(row);
                return {
                    sender_id: values[senderIndex],
                    receiver_id: values[receiverIndex]
                };
            })
            .filter(tx => tx.sender_id && tx.receiver_id);

        if (transactions.length === 0) {
            return res.status(400).json({
                error: "No valid transactions found."
            });
        }

        /* ==========================
           DETECTION ENGINE
        ========================== */

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
            const result = calculateSuspicion(
                acc,
                rings,
                fanIn,
                fanOut,
                velocityMap
            );

            if (result) {
                suspicious_accounts.push({
                    account_id: acc,
                    ...result
                });
            }
        });

        suspicious_accounts.sort(
            (a, b) => b.suspicion_score - a.suspicion_score
        );

        return res.json({
            suspicious_accounts,
            fraud_rings: rings,
            summary: {
                total_accounts_analyzed: accounts.size,
                suspicious_accounts_flagged: suspicious_accounts.length,
                fraud_rings_detected: rings.length,
                processing_time_seconds:
                    (Date.now() - startTime) / 1000
            }
        });

    } catch (error) {
        console.error("Analyze failed:", error);
        return res.status(500).json({
            error: "Analysis failed. Check CSV format."
        });
    } finally {
        if (uploadedPath && fs.existsSync(uploadedPath)) {
            fs.unlinkSync(uploadedPath);
        }
    }
});

/* ==========================
   SERVER START (Render Safe)
========================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
