// ====================================================================
// CASINO ROYALE — SCOREBOARD REALTIME SCORE DRIFT VERIFICATION SUITE
// Tests zero score drift, authoritative resulting_score usage,
// request sequencing, duplicate idempotency, and SET_SCORE replacement.
// ====================================================================

import assert from "node:assert";

class ScoreboardModel {
  constructor(initialEventId, initialLeaderboard = []) {
    this.eventId = initialEventId;
    this.leaderboard = initialLeaderboard.map((t) => ({ ...t }));
    this.prevScores = {};
    this.prevRanks = {};
    this.prevLeaderId = initialLeaderboard[0]?.team_id || null;
    this.latestRequestId = 0;
    this.latestProcessedTimestamp = 0;

    // Visual animation states (decoupled from score state)
    this.affectedTeamIds = [];
    this.scoreDeltas = {};
    this.showCurtainIntro = false;
    this.isSlotSpinning = false;
    this.rankShifts = {};
    this.crownCelebration = false;

    // Initialize baseline tracking
    initialLeaderboard.forEach((t) => {
      this.prevScores[t.team_id] = t.total_score;
      this.prevRanks[t.team_id] = t.rank;
    });
  }

  // Receives real-time broadcast event on scoreboard:{eventId} channel
  handleBroadcastMessage(message) {
    const payload = message?.payload;
    if (payload?.eventId && this.eventId && payload.eventId !== this.eventId) {
      return { action: "ignored_wrong_event" };
    }

    if (payload?.timestamp && payload.timestamp < this.latestProcessedTimestamp) {
      // Discard older out-of-order broadcast
      return { action: "discarded_out_of_order", timestamp: payload.timestamp };
    }

    if (payload?.timestamp) {
      this.latestProcessedTimestamp = payload.timestamp;
    }

    // Extract authoritative resulting scores
    const directScores = {};
    if (payload?.updated_scores && typeof payload.updated_scores === "object") {
      Object.entries(payload.updated_scores).forEach(([tId, s]) => {
        directScores[tId] = Number(s);
      });
    } else if (payload?.teamId && payload.resulting_score !== undefined) {
      directScores[payload.teamId] = Number(payload.resulting_score);
    }

    if (Object.keys(directScores).length > 0) {
      const result = this.applyDirectAuthoritativeScores(directScores);
      return { action: "applied_direct", ...result };
    }

    return { action: "no_scores_in_payload" };
  }

  // Applies authoritative scores directly from resulting_score (never score += delta)
  applyDirectAuthoritativeScores(scores) {
    const affected = [];
    const deltas = {};

    const updated = this.leaderboard.map((team) => {
      if (scores[team.team_id] !== undefined) {
        const newScore = scores[team.team_id];
        const oldScore = this.prevScores[team.team_id] ?? team.total_score;
        if (newScore !== oldScore) {
          affected.push(team.team_id);
          // Delta is calculated from old score to authoritative new resulting score
          deltas[team.team_id] = newScore - oldScore;
          this.prevScores[team.team_id] = newScore;
        }
        // Direct score replacement (NOT additive accumulation!)
        return { ...team, total_score: newScore };
      }
      return team;
    });

    if (affected.length === 0) {
      return { affectedCount: 0, deltas: {}, isDuplicate: true };
    }

    // Re-sort and re-rank authoritatively
    const sorted = [...updated].sort((a, b) => b.total_score - a.total_score);
    const ranked = sorted.map((t, idx) => ({ ...t, rank: idx + 1 }));

    // Compute rank shifts
    const newShifts = {};
    let hasShifts = false;
    ranked.forEach((t) => {
      const oldRank = this.prevRanks[t.team_id];
      if (oldRank !== undefined && oldRank !== t.rank) {
        hasShifts = true;
        newShifts[t.team_id] = {
          from: oldRank,
          to: t.rank,
          direction: t.rank < oldRank ? "up" : "down",
        };
      }
      this.prevRanks[t.team_id] = t.rank;
    });

    this.rankShifts = hasShifts ? newShifts : {};

    const currentTopId = ranked[0]?.team_id;
    if (currentTopId && this.prevLeaderId && currentTopId !== this.prevLeaderId) {
      this.crownCelebration = true;
    }
    this.prevLeaderId = currentTopId || null;

    this.leaderboard = ranked;
    this.affectedTeamIds = affected;
    this.scoreDeltas = deltas;
    this.showCurtainIntro = true;

    return { affectedCount: affected.length, deltas, isDuplicate: false };
  }

  // Simulates an async fetch to the authoritative database view v_public_overall_leaderboard
  async fetchFromDatabaseView(fetcherFn) {
    const requestId = ++this.latestRequestId;
    const viewData = await fetcherFn();

    // Check request sequencing: if a newer request was already issued, drop this response
    if (requestId !== this.latestRequestId) {
      return { action: "dropped_stale_response", requestId, currentRequestId: this.latestRequestId };
    }

    const nextLeaderboard = viewData.map((d) => ({
      team_id: String(d.team_id || ""),
      team_name: String(d.team_name || ""),
      total_score: Number(d.total_score || 0),
      rank: Number(d.rank || 1),
    }));

    const affected = [];
    const deltas = {};

    nextLeaderboard.forEach((team) => {
      const oldScore = this.prevScores[team.team_id];
      if (oldScore !== undefined && oldScore !== team.total_score) {
        affected.push(team.team_id);
        deltas[team.team_id] = team.total_score - oldScore;
      }
      this.prevScores[team.team_id] = team.total_score;
      this.prevRanks[team.team_id] = team.rank;
    });

    this.leaderboard = nextLeaderboard;
    if (affected.length > 0) {
      this.affectedTeamIds = affected;
      this.scoreDeltas = deltas;
      this.showCurtainIntro = true;
    }

    return { action: "applied_view_data", requestId, affectedCount: affected.length, deltas };
  }

  getTeamScore(teamId) {
    const t = this.leaderboard.find((team) => team.team_id === teamId);
    return t ? t.total_score : undefined;
  }

  getTeamRank(teamId) {
    const t = this.leaderboard.find((team) => team.team_id === teamId);
    return t ? t.rank : undefined;
  }
}

// --------------------------------------------------------------------
// TEST RUNNER
// --------------------------------------------------------------------

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log("\n=== CASINO ROYALE — SCOREBOARD REALTIME SCORE DRIFT TEST SUITE ===\n");

// --- TEST GROUP 1: MATHEMATICAL OPERATIONS ACCURACY ---
console.log("--- GROUP 1: 5 MATHEMATICAL OPERATIONS (AUTHORITATIVE REPLACEMENT) ---");

it("ADD operation: score replaced directly with resulting_score, delta recorded for visual reel", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 100, rank: 1 },
  ]);

  // Transaction: ADD 15 on 100 -> resulting_score = 115, delta = +15
  const res = sb.handleBroadcastMessage({
    payload: {
      eventId: "event-1",
      updated_scores: { "team-1": 115 },
      timestamp: 1001,
    },
  });

  assert.strictEqual(sb.getTeamScore("team-1"), 115, "Score must be 115");
  assert.strictEqual(sb.scoreDeltas["team-1"], 15, "Delta must be +15");
  assert.strictEqual(res.isDuplicate, false);
});

it("SUBTRACT operation: score replaced directly with resulting_score, delta is negative", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 115, rank: 1 },
  ]);

  // Transaction: SUBTRACT 15 on 115 -> resulting_score = 100, delta = -15
  sb.handleBroadcastMessage({
    payload: {
      eventId: "event-1",
      updated_scores: { "team-1": 100 },
      timestamp: 1002,
    },
  });

  assert.strictEqual(sb.getTeamScore("team-1"), 100, "Score must be 100");
  assert.strictEqual(sb.scoreDeltas["team-1"], -15, "Delta must be -15");
});

it("SUBTRACT operation clamped at zero: resulting_score is 0, delta reflects actual deduction", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 5, rank: 1 },
  ]);

  // Team had 5 points. Input was 20. Result clamped to 0. Actual points_delta = -5.
  sb.handleBroadcastMessage({
    payload: {
      eventId: "event-1",
      updated_scores: { "team-1": 0 },
      timestamp: 1003,
    },
  });

  assert.strictEqual(sb.getTeamScore("team-1"), 0, "Score must be 0 (clamped, never negative)");
  assert.strictEqual(sb.scoreDeltas["team-1"], -5, "Delta must reflect actual deduction of -5 (not raw input -20)");
});

it("MULTIPLY operation: score replaced directly with rounded resulting_score", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 25, rank: 1 },
  ]);

  // Transaction: MULTIPLY 2.5 on 25 -> resulting_score = 63 (ROUND(62.5)), delta = +38
  sb.handleBroadcastMessage({
    payload: {
      eventId: "event-1",
      updated_scores: { "team-1": 63 },
      timestamp: 1004,
    },
  });

  assert.strictEqual(sb.getTeamScore("team-1"), 63, "Score must be 63");
  assert.strictEqual(sb.scoreDeltas["team-1"], 38, "Delta must be +38");
});

it("DIVIDE operation: score replaced directly with rounded resulting_score", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 63, rank: 1 },
  ]);

  // Transaction: DIVIDE 3 on 63 -> resulting_score = 21, delta = -42
  sb.handleBroadcastMessage({
    payload: {
      eventId: "event-1",
      updated_scores: { "team-1": 21 },
      timestamp: 1005,
    },
  });

  assert.strictEqual(sb.getTeamScore("team-1"), 21, "Score must be 21");
  assert.strictEqual(sb.scoreDeltas["team-1"], -42, "Delta must be -42");
});

// --- TEST GROUP 2: SET_SCORE ABSOLUTE REPLACEMENT ---
console.log("\n--- GROUP 2: SET_SCORE ABSOLUTE REPLACEMENT (ZERO DRIFT) ---");

it("SET_SCORE (150 -> 50): score immediately replaces to 50 (never additive 150 + (-100) or 150 + 50)", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 150, rank: 1 },
    { team_id: "team-2", team_name: "Aces", total_score: 100, rank: 2 },
  ]);

  // SET_SCORE to 50
  const res = sb.handleBroadcastMessage({
    payload: {
      eventId: "event-1",
      updated_scores: { "team-1": 50 },
      timestamp: 1010,
    },
  });

  assert.strictEqual(sb.getTeamScore("team-1"), 50, "Displayed score MUST be exactly 50");
  assert.strictEqual(sb.scoreDeltas["team-1"], -100, "Visual delta badge must show -100");
  // Rank shift: team-1 drops below team-2
  assert.strictEqual(sb.getTeamRank("team-2"), 1, "Team 2 takes rank 1");
  assert.strictEqual(sb.getTeamRank("team-1"), 2, "Team 1 drops to rank 2");
  assert.strictEqual(sb.rankShifts["team-1"].direction, "down");
  assert.strictEqual(res.isDuplicate, false);
});

it("SET_SCORE followed by immediate SET_SCORE 0: score replaces to 0", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 50, rank: 1 },
  ]);

  sb.handleBroadcastMessage({
    payload: {
      eventId: "event-1",
      updated_scores: { "team-1": 0 },
      timestamp: 1011,
    },
  });

  assert.strictEqual(sb.getTeamScore("team-1"), 0, "Score must be 0");
  assert.strictEqual(sb.scoreDeltas["team-1"], -50, "Delta must be -50");
});

// --- TEST GROUP 3: DUPLICATE NOTIFICATIONS & IDEMPOTENCY ---
console.log("\n--- GROUP 3: DUPLICATE NOTIFICATIONS & IDEMPOTENCY ---");

it("Duplicate realtime broadcast does NOT add score twice or cause score drift", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 100, rank: 1 },
  ]);

  const payload = {
    eventId: "event-1",
    updated_scores: { "team-1": 120 },
    timestamp: 2000,
  };

  // First arrival
  const res1 = sb.handleBroadcastMessage({ payload });
  assert.strictEqual(sb.getTeamScore("team-1"), 120);
  assert.strictEqual(res1.isDuplicate, false);
  assert.strictEqual(sb.scoreDeltas["team-1"], 20);

  // Duplicate arrival (same timestamp / payload)
  const res2 = sb.handleBroadcastMessage({ payload });
  assert.strictEqual(sb.getTeamScore("team-1"), 120, "Score must remain 120 (NOT 140)");
  assert.strictEqual(res2.isDuplicate, true, "Must be flagged as duplicate");
});

it("Duplicate reversal notification does NOT reverse twice", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 120, rank: 1 },
  ]);

  // Reversal broadcast payload format
  const reversalPayload = {
    eventId: "event-1",
    teamId: "team-1",
    resulting_score: 100,
    points_delta: -20,
    timestamp: 2010,
  };

  // Arrival 1
  sb.handleBroadcastMessage({ payload: reversalPayload });
  assert.strictEqual(sb.getTeamScore("team-1"), 100);

  // Arrival 2 (duplicate network packet)
  const res = sb.handleBroadcastMessage({ payload: reversalPayload });
  assert.strictEqual(sb.getTeamScore("team-1"), 100, "Score remains 100");
  assert.strictEqual(res.isDuplicate, true);
});

// --- TEST GROUP 4: OUT-OF-ORDER BROADCAST PROTECTION ---
console.log("\n--- GROUP 4: OUT-OF-ORDER & DELAYED BROADCAST PROTECTION ---");

it("Out-of-order broadcast with older timestamp is dropped without overwriting newer score", () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 100, rank: 1 },
  ]);

  // 1. Transaction 1 at T=3000 sets score to 120
  sb.handleBroadcastMessage({
    payload: { eventId: "event-1", updated_scores: { "team-1": 120 }, timestamp: 3000 },
  });
  assert.strictEqual(sb.getTeamScore("team-1"), 120);

  // 2. Transaction 2 at T=3005 sets score to 150
  sb.handleBroadcastMessage({
    payload: { eventId: "event-1", updated_scores: { "team-1": 150 }, timestamp: 3005 },
  });
  assert.strictEqual(sb.getTeamScore("team-1"), 150);

  // 3. Delayed network packet from Transaction 1 arrives late (timestamp 3000 < latestProcessedTimestamp 3005)
  const delayedRes = sb.handleBroadcastMessage({
    payload: { eventId: "event-1", updated_scores: { "team-1": 120 }, timestamp: 3000 },
  });

  assert.strictEqual(delayedRes.action, "discarded_out_of_order");
  assert.strictEqual(sb.getTeamScore("team-1"), 150, "Delayed broadcast must NOT overwrite newer score 150 with old score 120");
});

// --- TEST GROUP 5: MONOTONIC REQUEST SEQUENCING IN DATABASE FETCHES ---
console.log("\n--- GROUP 5: MONOTONIC REQUEST SEQUENCING (ASYNC RACE CONDITIONS) ---");

await itAsync("Delayed earlier database response is discarded when newer response has resolved", async () => {
  const sb = new ScoreboardModel("event-1", [
    { team_id: "team-1", team_name: "Royals", total_score: 100, rank: 1 },
  ]);

  // Request 1 issued earlier (e.g. from score = 110), but delayed over slow network (takes 50ms)
  const slowPromise = sb.fetchFromDatabaseView(async () => {
    await new Promise((r) => setTimeout(r, 50));
    return [{ team_id: "team-1", team_name: "Royals", total_score: 110, rank: 1 }];
  });

  // Request 2 issued slightly later (e.g. score = 150), resolves quickly (takes 10ms)
  const fastPromise = sb.fetchFromDatabaseView(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return [{ team_id: "team-1", team_name: "Royals", total_score: 150, rank: 1 }];
  });

  const [resSlow, resFast] = await Promise.all([slowPromise, fastPromise]);

  assert.strictEqual(resFast.action, "applied_view_data", "Fast newer request must be applied");
  assert.strictEqual(resSlow.action, "dropped_stale_response", "Slow older request must be dropped");
  assert.strictEqual(sb.getTeamScore("team-1"), 150, "Authoritative score must remain 150 (not overwritten by 110)");
});

// --- TEST GROUP 6: CROSS-EVENT ISOLATION ---
console.log("\n--- GROUP 6: CROSS-EVENT ISOLATION ---");

it("Broadcasts from a different event ID are ignored", () => {
  const sb = new ScoreboardModel("event-alpha", [
    { team_id: "team-1", team_name: "Royals", total_score: 100, rank: 1 },
  ]);

  const res = sb.handleBroadcastMessage({
    payload: {
      eventId: "event-beta", // Different event!
      updated_scores: { "team-1": 999 },
      timestamp: 4000,
    },
  });

  assert.strictEqual(res.action, "ignored_wrong_event");
  assert.strictEqual(sb.getTeamScore("team-1"), 100, "Score must not change from cross-event broadcast");
});

// --- TEST GROUP 7: RECONCILIATION & PAGE REFRESH CONSISTENCY ---
console.log("\n--- GROUP 7: RECONCILIATION WITH ADMIN SCORE CONTROL & PAGE REFRESH ---");

it("Page refresh simulation: cold mount matches database view with zero drift", () => {
  // DB view authoritative data after multiple operations (ADD, SET_SCORE, SUBTRACT, REVERSAL)
  const dbViewData = [
    { team_id: "team-1", team_name: "Royals", total_score: 50, rank: 2 },
    { team_id: "team-2", team_name: "Aces", total_score: 140, rank: 1 },
    { team_id: "team-3", team_name: "Jokers", total_score: 0, rank: 3 },
  ];

  // Cold mount on browser page refresh
  const refreshedSb = new ScoreboardModel("event-1", dbViewData);

  assert.strictEqual(refreshedSb.getTeamScore("team-1"), 50);
  assert.strictEqual(refreshedSb.getTeamScore("team-2"), 140);
  assert.strictEqual(refreshedSb.getTeamScore("team-3"), 0);
  assert.strictEqual(refreshedSb.getTeamRank("team-2"), 1);
  assert.strictEqual(refreshedSb.getTeamRank("team-1"), 2);
  assert.strictEqual(refreshedSb.getTeamRank("team-3"), 3);
  assert.strictEqual(refreshedSb.showCurtainIntro, false, "Initial mount must not play phantom animations");
});

console.log("\n=============================================================");
console.log(`SUMMARY: ${passed} / ${passed + failed} tests passed cleanly!`);
console.log("=============================================================\n");

if (failed > 0) {
  process.exit(1);
}
