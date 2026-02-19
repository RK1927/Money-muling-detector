const { v4: uuidv4 } = require("uuid");

/* -------------------------------
   GRAPH BUILDING
--------------------------------*/
function buildGraph(transactions) {
    const graph = {};
    const velocityMap = {};

    transactions.forEach(tx => {
        if (!graph[tx.sender_id]) graph[tx.sender_id] = [];
        graph[tx.sender_id].push(tx.receiver_id);

        velocityMap[tx.sender_id] = (velocityMap[tx.sender_id] || 0) + 1;
    });

    return { graph, velocityMap };
}

/* -------------------------------
   CYCLE DETECTION (DFS up to 6)
--------------------------------*/
function detectCycles(graph) {
    const rings = [];
    let ringCount = 1;

    function dfs(start, current, path, depth) {
        if (depth > 6) return;

        if (graph[current]) {
            for (let neighbor of graph[current]) {
                if (neighbor === start && path.length >= 3) {
                    rings.push({
                        ring_id: `RING_${String(ringCount++).padStart(3, "0")}`,
                        member_accounts: [...path],
                        pattern_type: "cycle",
                        risk_score: 90 + path.length
                    });
                }
                if (!path.includes(neighbor)) {
                    dfs(start, neighbor, [...path, neighbor], depth + 1);
                }
            }
        }
    }

    for (let node in graph) {
        dfs(node, node, [node], 0);
    }

    return rings;
}

/* -------------------------------
   FAN-IN / FAN-OUT
--------------------------------*/
function detectFanPatterns(transactions) {
    const fanIn = {};
    const fanOut = {};

    transactions.forEach(tx => {
        fanOut[tx.sender_id] = (fanOut[tx.sender_id] || 0) + 1;
        fanIn[tx.receiver_id] = (fanIn[tx.receiver_id] || 0) + 1;
    });

    return { fanIn, fanOut };
}

/* -------------------------------
   SUSPICION ENGINE
--------------------------------*/
function calculateSuspicion(account, rings, fanIn, fanOut, velocityMap) {

    let score = 0;
    let patterns = [];
    let ringId = null;

    const ring = rings.find(r => r.member_accounts.includes(account));
    if (ring) {
        score += 50;
        patterns.push("cycle_network");
        ringId = ring.ring_id;
    }

    if (fanIn[account] >= 5) {
        score += 20;
        patterns.push("high_fan_in");
    }

    if (fanOut[account] >= 5) {
        score += 20;
        patterns.push("high_fan_out");
    }

    if (velocityMap[account] >= 10) {
        score += 10;
        patterns.push("high_velocity");
    }

    score = Math.min(100, score);

    if (score === 0) return null;

    return {
        suspicion_score: score,
        detected_patterns: patterns,
        ring_id: ringId || "N/A"
    };
}

module.exports = {
    buildGraph,
    detectCycles,
    detectFanPatterns,
    calculateSuspicion
};
