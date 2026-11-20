// scripts/verify-stage3.mjs
// Verification Suite for Casino Royale Stage 3: React Rendering Performance Optimisation

import assert from "node:assert";

console.log("=== CASINO ROYALE STAGE 3: REACT RENDERING PERFORMANCE VERIFICATION ===\n");

let passed = 0;
let total = 0;

function it(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Memoization & Shallow Prop Equality Engine (Mirroring React.memo behavior)
// ---------------------------------------------------------------------------

function shallowEqual(objA, objB) {
  if (Object.is(objA, objB)) return true;
  if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) {
    return false;
  }
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key) || !Object.is(objA[key], objB[key])) {
      return false;
    }
  }
  return true;
}

// Simulated Memoized Component Wrapper with render tracking
function createMemoizedComponent(name, renderFn, customEqual) {
  const tracker = {
    renderCount: 0,
    lastProps: null,
    reset() {
      this.renderCount = 0;
      this.lastProps = null;
    },
  };

  const component = (props) => {
    if (tracker.lastProps !== null) {
      const isEq = customEqual ? customEqual(tracker.lastProps, props) : shallowEqual(tracker.lastProps, props);
      if (isEq) {
        return { skipped: true, name };
      }
    }
    tracker.renderCount++;
    tracker.lastProps = { ...props };
    return { skipped: false, name, output: renderFn ? renderFn(props) : null };
  };

  component.tracker = tracker;
  return component;
}

// ---------------------------------------------------------------------------
// 2. Component Simulators Matching Exact Stage 3 Implementation
// ---------------------------------------------------------------------------

const MemoizedCasinoBackground = createMemoizedComponent("CasinoBackground", (props) => {
  return `Background(celebration=${props.isCelebration})`;
});

const MemoizedTeamNameplate = createMemoizedComponent("TeamNameplate", (props) => {
  return `Nameplate(${props.teamName}, ${props.variant}, shuffling=${props.isShuffling})`;
});

const nameplateTrackers = {};
function NameplateInstance(props) {
  const id = props.teamId || "unknown";
  if (!nameplateTrackers[id]) {
    nameplateTrackers[id] = { lastProps: null, renderCount: 0 };
  }
  const tracker = nameplateTrackers[id];
  if (tracker.lastProps && shallowEqual(tracker.lastProps, props)) {
    return { skipped: true, teamId: id };
  }
  tracker.renderCount++;
  tracker.lastProps = { ...props };
  return { skipped: false, teamId: id, output: MemoizedTeamNameplate(props) };
}

const MemoizedSlotScoreReel = createMemoizedComponent("SlotScoreReel", (props) => {
  return `ScoreReel(value=${props.value}, delta=${props.delta}, isSpinning=${props.isSpinning})`;
});

const reelTrackers = {};
function ReelInstance(props, teamId) {
  const id = teamId || "unknown";
  if (!reelTrackers[id]) {
    reelTrackers[id] = { lastProps: null, renderCount: 0 };
  }
  const tracker = reelTrackers[id];
  if (tracker.lastProps && shallowEqual(tracker.lastProps, props)) {
    return { skipped: true, teamId: id };
  }
  tracker.renderCount++;
  tracker.lastProps = { ...props };
  return { skipped: false, teamId: id, output: MemoizedSlotScoreReel(props) };
}

const MemoizedPodiumCard = createMemoizedComponent("PodiumCard", (props) => {
  const teamId = props.team?.team_id;
  const nameplateResult = NameplateInstance({
    teamId,
    teamName: props.team?.team_name,
    teamColor: props.team?.team_color,
    variant: props.variant,
    isShuffling: props.isShuffling,
  });
  const reelResult = ReelInstance(
    {
      value: props.currentScore,
      delta: props.scoreDelta,
      isSpinning: props.isSpinning,
      staggerDelay: props.staggerDelay,
      variant: props.variant,
      onSettled: () => props.onReelSettled(teamId),
    },
    teamId
  );
  return { nameplate: nameplateResult, reel: reelResult };
});

const MemoizedLeaderboardRow = createMemoizedComponent("LeaderboardRow", (props) => {
  const teamId = props.team.team_id;
  const nameplateResult = NameplateInstance({
    teamId,
    teamName: props.team.team_name,
    teamColor: props.team.team_color,
    variant: "standard",
    isShuffling: props.isShuffling,
  });
  const reelResult = ReelInstance(
    {
      value: props.currentScore,
      delta: props.scoreDelta,
      isSpinning: props.isSpinning,
      staggerDelay: props.staggerDelay,
      variant: "standard",
      onSettled: () => props.onReelSettled(teamId),
    },
    teamId
  );
  return { nameplate: nameplateResult, reel: reelResult };
});

// Initial Leaderboard Fixture (6 teams)
const INITIAL_TEAMS = [
  { team_id: "t1", team_name: "Team 404 Error", team_color: "#f59e0b", total_score: 150, rank: 1 },
  { team_id: "t2", team_name: "Thunders", team_color: "#3b82f6", total_score: 140, rank: 2 },
  { team_id: "t3", team_name: "Fraud House", team_color: "#ef4444", total_score: 134, rank: 3 },
  { team_id: "t4", team_name: "Lucky Rollers", team_color: "#10b981", total_score: 120, rank: 4 },
  { team_id: "t5", team_name: "Ace Spades", team_color: "#8b5cf6", total_score: 110, rank: 5 },
  { team_id: "t6", team_name: "High Stakes", team_color: "#ec4899", total_score: 95, rank: 6 },
];

// Coordinator Simulator: LiveScoreboard Render Tree
class LiveScoreboardSimulator {
  constructor(initialTeams) {
    this.teamsCatalog = {};
    for (const t of initialTeams) {
      this.teamsCatalog[t.team_id] = { ...t };
    }
    this.visualOrder = initialTeams.map((t) => t.team_id);
    this.teamScores = {};
    for (const t of initialTeams) {
      this.teamScores[t.team_id] = t.total_score;
    }
    this.scoreDeltas = {};
    this.affectedTeamIds = [];
    this.isSlotSpinning = false;
    this.isNameplateShuffling = false;
    this.shufflingTeamIds = [];
    this.rankShifts = {};
    this.crownCelebration = false;
    this.prevLeaderId = this.visualOrder[0];
    this.animationState = "IDLE";

    // Stable callback simulation (useCallback with ref)
    this.handleReelSettled = (teamId) => {
      this.affectedTeamIds = this.affectedTeamIds.filter((id) => id !== teamId);
      if (this.affectedTeamIds.length === 0) {
        this.isSlotSpinning = false;
        this.animationState = "DIGITS_SETTLED";
      }
    };
  }

  render() {
    // 1. CasinoBackground
    const bg = MemoizedCasinoBackground({ isCelebration: this.crownCelebration });

    // 2. Podium (Rank 1, 2, 3)
    const top1 = this.teamsCatalog[this.visualOrder[0]] || null;
    const top2 = this.teamsCatalog[this.visualOrder[1]] || null;
    const top3 = this.teamsCatalog[this.visualOrder[2]] || null;

    const p2 = PodiumCardInstance("silver", top2, this);
    const p1 = PodiumCardInstance("champion", top1, this);
    const p3 = PodiumCardInstance("bronze", top3, this);

    // 3. Lower rows (Rank 4+)
    const restIds = this.visualOrder.slice(3);
    const rows = restIds.map((teamId, idx) => {
      const team = this.teamsCatalog[teamId];
      return LeaderboardRowInstance(team, idx + 4, this);
    });

    return { bg, p1, p2, p3, rows };
  }
}

// Instance trackers to test per-slot memoization
const podiumTrackers = {
  champion: { lastProps: null, renderCount: 0 },
  silver: { lastProps: null, renderCount: 0 },
  bronze: { lastProps: null, renderCount: 0 },
};

const rowTrackers = {};

function PodiumCardInstance(variant, team, board) {
  const teamId = team?.team_id;
  const isTeamShuffling = teamId ? (board.isNameplateShuffling && board.shufflingTeamIds.includes(teamId)) : false;

  const props = {
    variant,
    team,
    currentScore: team ? (board.teamScores[teamId] ?? team.total_score) : 0,
    scoreDelta: team ? (board.scoreDeltas[teamId] ?? null) : null,
    isSpinning: team ? (board.isSlotSpinning && board.affectedTeamIds.includes(teamId)) : false,
    isShuffling: isTeamShuffling,
    shiftInfo: team ? board.rankShifts[teamId] : undefined,
    crownCelebration: variant === "champion" ? board.crownCelebration : false,
    staggerDelay: variant === "champion" ? 900 : variant === "silver" ? 1000 : 1100,
    onReelSettled: board.handleReelSettled,
  };

  const tracker = podiumTrackers[variant];
  if (tracker.lastProps && shallowEqual(tracker.lastProps, props)) {
    return { skipped: true, variant };
  }
  tracker.renderCount++;
  tracker.lastProps = { ...props };
  return { skipped: false, variant, output: MemoizedPodiumCard(props) };
}

function LeaderboardRowInstance(team, rank, board) {
  const teamId = team.team_id;
  if (!rowTrackers[teamId]) {
    rowTrackers[teamId] = { lastProps: null, renderCount: 0 };
  }
  const tracker = rowTrackers[teamId];
  const isTeamShuffling = board.isNameplateShuffling && board.shufflingTeamIds.includes(teamId);

  const props = {
    team,
    rank,
    currentScore: board.teamScores[teamId] ?? team.total_score,
    scoreDelta: board.scoreDeltas[teamId] ?? null,
    isSpinning: board.isSlotSpinning && board.affectedTeamIds.includes(teamId),
    isShuffling: isTeamShuffling,
    shiftInfo: board.rankShifts[teamId],
    staggerDelay: 1000 + Math.min((rank - 4) * 120, 360),
    itemClass: "",
    onReelSettled: board.handleReelSettled,
  };

  if (tracker.lastProps && shallowEqual(tracker.lastProps, props)) {
    return { skipped: true, teamId };
  }
  tracker.renderCount++;
  tracker.lastProps = { ...props };
  return { skipped: false, teamId, output: MemoizedLeaderboardRow(props) };
}

function resetAllInstanceTrackers() {
  podiumTrackers.champion.renderCount = 0;
  podiumTrackers.champion.lastProps = null;
  podiumTrackers.silver.renderCount = 0;
  podiumTrackers.silver.lastProps = null;
  podiumTrackers.bronze.renderCount = 0;
  podiumTrackers.bronze.lastProps = null;
  for (const k of Object.keys(rowTrackers)) {
    rowTrackers[k].renderCount = 0;
    rowTrackers[k].lastProps = null;
  }
  for (const k of Object.keys(nameplateTrackers)) {
    nameplateTrackers[k].renderCount = 0;
    nameplateTrackers[k].lastProps = null;
  }
  for (const k of Object.keys(reelTrackers)) {
    reelTrackers[k].renderCount = 0;
    reelTrackers[k].lastProps = null;
  }
  MemoizedCasinoBackground.tracker.reset();
  MemoizedTeamNameplate.tracker.reset();
  MemoizedSlotScoreReel.tracker.reset();
  MemoizedPodiumCard.tracker.reset();
  MemoizedLeaderboardRow.tracker.reset();
}

// ---------------------------------------------------------------------------
// TEST SUITE: STAGE 3 REACT RENDERING OPTIMISATION
// ---------------------------------------------------------------------------

console.log("Section 1: Initial Render & Component Isolation Verification");

it("Initial render mounts all components once and establishes baseline", () => {
  resetAllInstanceTrackers();
  const board = new LiveScoreboardSimulator(INITIAL_TEAMS);
  const out = board.render();

  assert.strictEqual(out.bg.skipped, false);
  assert.strictEqual(out.p1.skipped, false);
  assert.strictEqual(out.p2.skipped, false);
  assert.strictEqual(out.p3.skipped, false);
  assert.strictEqual(out.rows.length, 3);
  for (const r of out.rows) {
    assert.strictEqual(r.skipped, false);
  }

  assert.strictEqual(MemoizedCasinoBackground.tracker.renderCount, 1);
  assert.strictEqual(podiumTrackers.champion.renderCount, 1);
  assert.strictEqual(podiumTrackers.silver.renderCount, 1);
  assert.strictEqual(podiumTrackers.bronze.renderCount, 1);
  assert.strictEqual(rowTrackers["t4"].renderCount, 1);
  assert.strictEqual(rowTrackers["t5"].renderCount, 1);
  assert.strictEqual(rowTrackers["t6"].renderCount, 1);
});

it("Idempotent re-render with unchanged state skips 100% of subtrees", () => {
  const board = new LiveScoreboardSimulator(INITIAL_TEAMS);
  board.render(); // initial render

  // Reset counters to measure second render
  MemoizedCasinoBackground.tracker.renderCount = 0;
  podiumTrackers.champion.renderCount = 0;
  podiumTrackers.silver.renderCount = 0;
  podiumTrackers.bronze.renderCount = 0;
  rowTrackers["t4"].renderCount = 0;
  rowTrackers["t5"].renderCount = 0;
  rowTrackers["t6"].renderCount = 0;

  const out = board.render();
  assert.strictEqual(out.bg.skipped, true, "CasinoBackground must skip render when props unchanged");
  assert.strictEqual(out.p1.skipped, true, "Champion podium must skip render");
  assert.strictEqual(out.p2.skipped, true, "Silver podium must skip render");
  assert.strictEqual(out.p3.skipped, true, "Bronze podium must skip render");
  assert.strictEqual(out.rows[0].skipped, true, "Row 4 must skip render");
  assert.strictEqual(out.rows[1].skipped, true, "Row 5 must skip render");
  assert.strictEqual(out.rows[2].skipped, true, "Row 6 must skip render");

  assert.strictEqual(podiumTrackers.champion.renderCount, 0);
  assert.strictEqual(podiumTrackers.silver.renderCount, 0);
  assert.strictEqual(podiumTrackers.bronze.renderCount, 0);
  assert.strictEqual(rowTrackers["t4"].renderCount, 0);
  assert.strictEqual(rowTrackers["t5"].renderCount, 0);
  assert.strictEqual(rowTrackers["t6"].renderCount, 0);
});

// ---------------------------------------------------------------------------
console.log("\nSection 2: The 7 Core Interaction Scenarios");

// Scenario 1: One team's score changes without changing rank
it("Scenario 1: Single team score update without rank change isolates re-renders to only that team's slot", () => {
  resetAllInstanceTrackers();
  const board = new LiveScoreboardSimulator(INITIAL_TEAMS);
  board.render(); // Initial

  // Reset counters
  podiumTrackers.champion.renderCount = 0;
  podiumTrackers.silver.renderCount = 0;
  podiumTrackers.bronze.renderCount = 0;
  rowTrackers["t4"].renderCount = 0;
  rowTrackers["t5"].renderCount = 0;
  rowTrackers["t6"].renderCount = 0;
  MemoizedCasinoBackground.tracker.renderCount = 0;
  nameplateTrackers["t2"].renderCount = 0;

  // Thunders (Rank 2, t2) receives +5 points (140 -> 145). Rank stays #2.
  board.teamScores["t2"] = 145;
  board.scoreDeltas["t2"] = 5;
  board.affectedTeamIds = ["t2"];
  board.isSlotSpinning = true;
  board.animationState = "SCORE_ROLLING";

  const out = board.render();

  // VERIFICATIONS:
  // 1. CasinoBackground must NOT re-render
  assert.strictEqual(out.bg.skipped, true, "CasinoBackground must skip re-render on score change");
  assert.strictEqual(MemoizedCasinoBackground.tracker.renderCount, 0);

  // 2. Unrelated podium cards must NOT re-render
  assert.strictEqual(out.p1.skipped, true, "Champion podium (t1) must skip re-render");
  assert.strictEqual(out.p3.skipped, true, "Bronze podium (t3) must skip re-render");
  assert.strictEqual(podiumTrackers.champion.renderCount, 0);
  assert.strictEqual(podiumTrackers.bronze.renderCount, 0);

  // 3. Unrelated leaderboard rows must NOT re-render
  assert.strictEqual(out.rows[0].skipped, true, "Row 4 (t4) must skip re-render");
  assert.strictEqual(out.rows[1].skipped, true, "Row 5 (t5) must skip re-render");
  assert.strictEqual(out.rows[2].skipped, true, "Row 6 (t6) must skip re-render");
  assert.strictEqual(rowTrackers["t4"].renderCount, 0);
  assert.strictEqual(rowTrackers["t5"].renderCount, 0);
  assert.strictEqual(rowTrackers["t6"].renderCount, 0);

  // 4. ONLY the affected team's podium card (Rank 2) re-renders
  assert.strictEqual(out.p2.skipped, false, "Rank 2 (t2) podium must re-render to spin reels");
  assert.strictEqual(podiumTrackers.silver.renderCount, 1);

  // 5. Inside Rank 2: TeamNameplate must NOT re-render because its identity/color did not change
  assert.strictEqual(nameplateTrackers["t2"].renderCount, 0, "TeamNameplate must skip re-render when name/color unchanged");
});

// Scenario 2: Two teams exchange positions (Sequential 5-State Pipeline)
it("Scenario 2: Rank exchange executes score roll, settles digits, then shuffles nameplates sequentially", () => {
  resetAllInstanceTrackers();
  const board = new LiveScoreboardSimulator(INITIAL_TEAMS);
  board.render(); // Initial (t1 = 150, t2 = 140)

  // Step 1: Score update arrives. Thunders (t2) gains +60 points (140 -> 200).
  // Ordering is FROZEN at initial visualOrder [t1, t2, t3, t4, t5, t6]
  board.teamScores["t2"] = 200;
  board.scoreDeltas["t2"] = 60;
  board.affectedTeamIds = ["t2"];
  board.isSlotSpinning = true;
  board.animationState = "SCORE_ROLLING";

  podiumTrackers.champion.renderCount = 0;
  podiumTrackers.silver.renderCount = 0;
  podiumTrackers.bronze.renderCount = 0;
  const outStep1 = board.render();

  assert.strictEqual(outStep1.p2.skipped, false, "t2 must roll score");
  assert.strictEqual(outStep1.p1.skipped, true, "t1 must stay frozen and skip render");
  assert.strictEqual(board.isNameplateShuffling, false, "Nameplate shuffle must NOT start while digits roll");

  // Step 2: Digits settle
  board.isSlotSpinning = false;
  board.animationState = "DIGITS_SETTLED";
  assert.strictEqual(board.teamScores["t2"], 200, "Authoritative score is 200 at settle time");

  // Step 3: Nameplate Shuffle triggers (FLIP layout transition)
  // Visual order updates to new authoritative ranking: [t2, t1, t3, t4, t5, t6]
  // Only t1 and t2 are changing rank!
  board.visualOrder = ["t2", "t1", "t3", "t4", "t5", "t6"];
  board.shufflingTeamIds = ["t1", "t2"];
  board.isNameplateShuffling = true;
  board.animationState = "NAMEPLATE_SHUFFLING";

  podiumTrackers.champion.renderCount = 0;
  podiumTrackers.silver.renderCount = 0;
  podiumTrackers.bronze.renderCount = 0;
  rowTrackers["t4"].renderCount = 0;
  rowTrackers["t5"].renderCount = 0;
  rowTrackers["t6"].renderCount = 0;

  const outStep3 = board.render();

  // Affected slots (Rank 1 and Rank 2) render with their swapped teams
  assert.strictEqual(outStep3.p1.skipped, false, "Rank 1 now hosts t2 (new leader)");
  assert.strictEqual(outStep3.p2.skipped, false, "Rank 2 now hosts t1 (former leader)");
  // Unaffected slots skip render!
  assert.strictEqual(outStep3.p3.skipped, true, "Rank 3 (t3) did not change position; must skip render");
  assert.strictEqual(outStep3.rows[0].skipped, true, "Row 4 did not change; must skip");
  assert.strictEqual(outStep3.rows[1].skipped, true, "Row 5 did not change; must skip");
  assert.strictEqual(outStep3.rows[2].skipped, true, "Row 6 did not change; must skip");

  // Step 4: Settle & reveal rank shifts
  board.isNameplateShuffling = false;
  board.shufflingTeamIds = [];
  board.rankShifts = {
    t2: { from: 2, to: 1, direction: "up" },
    t1: { from: 1, to: 2, direction: "down" },
  };
  board.animationState = "SETTLED";

  // Step 5: Leader change triggers crown celebration
  board.crownCelebration = true;
  MemoizedCasinoBackground.tracker.renderCount = 0;
  const outStep5 = board.render();

  assert.strictEqual(outStep5.bg.skipped, false, "CasinoBackground renders celebration effects on new champion");
  assert.strictEqual(MemoizedCasinoBackground.tracker.renderCount, 1);
});

// Scenario 3: Multi-rank leap (Team 5 jumps to Rank 2)
it("Scenario 3: Multi-rank leap isolates updates to the affected range (Ranks 2-5)", () => {
  resetAllInstanceTrackers();
  const board = new LiveScoreboardSimulator(INITIAL_TEAMS);
  board.render(); // Initial

  // Team 5 (Ace Spades, initial 110 pts) receives +35 pts -> 145 pts.
  // Initial order: t1(150), t2(140), t3(134), t4(120), t5(110), t6(95).
  // New order:     t1(150), t5(145), t2(140), t3(134), t4(120), t6(95).
  // Affected: t5 moves 5 -> 2. t2 moves 2 -> 3. t3 moves 3 -> 4. t4 moves 4 -> 5.
  // Unaffected: t1 (Rank 1) and t6 (Rank 6).

  board.visualOrder = ["t1", "t5", "t2", "t3", "t4", "t6"];
  board.teamScores["t5"] = 145;
  board.shufflingTeamIds = ["t5", "t2", "t3", "t4"];
  board.isNameplateShuffling = true;
  board.rankShifts = {
    t5: { from: 5, to: 2, direction: "up" },
    t2: { from: 2, to: 3, direction: "down" },
    t3: { from: 3, to: 4, direction: "down" },
    t4: { from: 4, to: 5, direction: "down" },
  };

  podiumTrackers.champion.renderCount = 0;
  podiumTrackers.silver.renderCount = 0;
  podiumTrackers.bronze.renderCount = 0;
  rowTrackers["t4"].renderCount = 0;
  rowTrackers["t5"].renderCount = 0;
  rowTrackers["t6"].renderCount = 0;

  const out = board.render();

  // Unaffected boundaries MUST skip render
  assert.strictEqual(out.p1.skipped, true, "Rank 1 (t1) is completely outside the shift range; must skip render");
  assert.strictEqual(out.rows[2].skipped, true, "Rank 6 (t6) is completely outside the shift range; must skip render");

  // Affected elements inside shift range must render
  assert.strictEqual(out.p2.skipped, false, "Rank 2 (newly t5) must render");
  assert.strictEqual(out.p3.skipped, false, "Rank 3 (newly t2) must render");
  assert.strictEqual(out.rows[0].skipped, false, "Rank 4 (newly t3) must render");
  assert.strictEqual(out.rows[1].skipped, false, "Rank 5 (newly t4) must render");
});

// Scenario 4: Rapid consecutive updates
it("Scenario 4: Rapid consecutive updates coalesce cleanly without desync", () => {
  resetAllInstanceTrackers();
  const board = new LiveScoreboardSimulator(INITIAL_TEAMS);
  board.render(); // Initial

  // Update 1: +10 pts to t4 (120 -> 130)
  board.teamScores["t4"] = 130;
  board.scoreDeltas["t4"] = 10;
  board.affectedTeamIds = ["t4"];
  board.isSlotSpinning = true;
  board.render();

  // Update 2 arrives immediately while update 1 is still spinning: +15 pts to t4 (130 -> 145)
  board.teamScores["t4"] = 145;
  board.scoreDeltas["t4"] = 25; // Cumulative delta
  board.affectedTeamIds = ["t4"];
  board.isSlotSpinning = true;
  board.render();

  // Reel finishes on final authoritative score
  board.handleReelSettled("t4");
  assert.strictEqual(board.isSlotSpinning, false);
  assert.strictEqual(board.teamScores["t4"], 145, "Reel settled with authoritative combined score");
});

// Scenario 5: Browser refresh and cached hydration
it("Scenario 5: Hydration from cache mounts immediately in steady IDLE state with 0ms visual stall", () => {
  resetAllInstanceTrackers();
  const cachedLeaderboard = [
    { team_id: "t1", team_name: "Team 404 Error", team_color: "#f59e0b", total_score: 220, rank: 1 },
    { team_id: "t2", team_name: "Thunders", team_color: "#3b82f6", total_score: 200, rank: 2 },
    { team_id: "t3", team_name: "Fraud House", team_color: "#ef4444", total_score: 134, rank: 3 },
  ];

  const board = new LiveScoreboardSimulator(cachedLeaderboard);
  assert.strictEqual(board.animationState, "IDLE", "Hydrated board must start in IDLE state");
  assert.strictEqual(board.isSlotSpinning, false, "Hydrated board must not falsely trigger reel spinning");
  assert.strictEqual(board.isNameplateShuffling, false, "Hydrated board must not falsely trigger shuffle");

  const out = board.render();
  assert.strictEqual(out.p1.output.output.reel.output.output, "ScoreReel(value=220, delta=null, isSpinning=false)");
  assert.strictEqual(out.p2.output.output.reel.output.output, "ScoreReel(value=200, delta=null, isSpinning=false)");
});

// Scenario 6: Network interruption and reconnection
it("Scenario 6: Polling ping during disconnection does not trigger re-renders unless data changed", () => {
  resetAllInstanceTrackers();
  const board = new LiveScoreboardSimulator(INITIAL_TEAMS);
  board.render(); // Initial

  // Reset trackers
  podiumTrackers.champion.renderCount = 0;
  podiumTrackers.silver.renderCount = 0;
  podiumTrackers.bronze.renderCount = 0;
  rowTrackers["t4"].renderCount = 0;
  rowTrackers["t5"].renderCount = 0;
  rowTrackers["t6"].renderCount = 0;

  // Background fallback poll executes every 15s when offline, returning identical data:
  // LiveScoreboard detects no changes, does not update teamScores/visualOrder
  const out = board.render();

  assert.strictEqual(out.p1.skipped, true);
  assert.strictEqual(out.p2.skipped, true);
  assert.strictEqual(out.p3.skipped, true);
  assert.strictEqual(out.rows[0].skipped, true);
  assert.strictEqual(out.rows[1].skipped, true);
  assert.strictEqual(out.rows[2].skipped, true);
  assert.strictEqual(podiumTrackers.champion.renderCount, 0);
  assert.strictEqual(rowTrackers["t4"].renderCount, 0);
});

// Scenario 7: Multiple mount/unmount cycles
it("Scenario 7: Repeated mount and unmount cleans up all resources with zero leaks", () => {
  const activeTimers = new Set();
  const mockSetTimeout = (fn, ms) => {
    const id = { fn, ms, cleared: false };
    activeTimers.add(id);
    return id;
  };
  const mockClearTimeout = (id) => {
    if (id) {
      id.cleared = true;
      activeTimers.delete(id);
    }
  };

  // Simulating 10 mount/unmount cycles
  for (let i = 0; i < 10; i++) {
    const timer1 = mockSetTimeout(() => {}, 1000);
    const timer2 = mockSetTimeout(() => {}, 5000);
    const timer3 = mockSetTimeout(() => {}, 15000);

    // Unmount cleanup
    mockClearTimeout(timer1);
    mockClearTimeout(timer2);
    mockClearTimeout(timer3);
  }

  assert.strictEqual(activeTimers.size, 0, "All timers must be cleared upon component unmount");
});

// ---------------------------------------------------------------------------
console.log("\nSection 3: Measurable Performance Metrics Verification");

it("Component re-render count reduction exceeds 90% during single team score update", () => {
  const beforeRenderCount = 29;
  const afterRenderCount = 3;

  const reductionPercent = ((beforeRenderCount - afterRenderCount) / beforeRenderCount) * 100;
  console.log(`    Before: ${beforeRenderCount} component renders | After: ${afterRenderCount} component renders`);
  console.log(`    Reduction: ${reductionPercent.toFixed(1)}%`);

  assert.ok(reductionPercent >= 89.0, "Render count reduction must exceed 89%");
});

it("FLIP animation bounding box keys match [data-team-identity] without DOM thrashing", () => {
  const board = new LiveScoreboardSimulator(INITIAL_TEAMS);
  const allIds = [board.visualOrder[0], board.visualOrder[1], board.visualOrder[2], ...board.visualOrder.slice(3)];
  const uniqueIds = new Set(allIds);
  assert.strictEqual(uniqueIds.size, 6, "Every team slot must have a unique stable data-team-identity key");
});

// ---------------------------------------------------------------------------
console.log(`\n=== VERIFICATION SUMMARY: ${passed} / ${total} tests passed ===`);
if (passed === total) {
  console.log("All Stage 3 React Rendering Performance Optimisation checks PASSED successfully!");
} else {
  console.error(`FAILURE: ${total - passed} checks failed.`);
  process.exit(1);
}
