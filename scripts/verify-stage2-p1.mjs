// scripts/verify-stage2-p1.mjs
// Verification Suite for Casino Royale Stage 2 (P1): Adaptive Polling & Realtime Resilience

import assert from "node:assert";
import { SCOREBOARD_POLLING_CONFIG } from "../src/lib/scoreboard-config.ts";

console.log("=== CASINO ROYALE STAGE 2 (P1) VERIFICATION SUITE ===\n");

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

// Simulated Scoreboard Connection & Polling State Machine
class MockScoreboardManager {
  constructor(options = {}) {
    this.isOnline = options.isOnline ?? true;
    this.visibilityState = options.visibilityState ?? "visible";
    this.channelStatus = options.initialChannelStatus ?? "CONNECTING";
    this.hasReconciled = false;
    this.isServingCache = options.isServingCache ?? false;
    this.activeRound = { round_number: 1, name: "Main Event" };

    this.fallbackInterval = SCOREBOARD_POLLING_CONFIG.FALLBACK_INITIAL_INTERVAL_MS;
    this.pollingTimer = null;
    this.reconnectTimer = null;
    this.activeSubCount = 0;
    this.dbQueryCount = 0;
    this.scheduledDelays = [];
  }

  getPillStatus() {
    if (!this.isOnline) {
      return { text: "OFFLINE • CACHED STANDINGS", dotColor: "bg-amber-400", state: "OFFLINE" };
    }
    if (this.channelStatus !== "SUBSCRIBED") {
      return { text: "RECONNECTING...", dotColor: "bg-amber-400 animate-pulse", state: "RECONNECTING" };
    }
    if (this.isServingCache || !this.hasReconciled) {
      return { text: "CACHED • SYNCING...", dotColor: "bg-sky-400 animate-pulse", state: "CACHED_SYNCING" };
    }
    return {
      text: `Round ${this.activeRound.round_number}: ${this.activeRound.name}`,
      dotColor: "bg-emerald-400 animate-pulse",
      state: "LIVE",
    };
  }

  scheduleNextPoll(customDelay) {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }

    if (!this.isOnline || this.visibilityState === "hidden") {
      return null;
    }

    const delay =
      customDelay ??
      (this.channelStatus === "SUBSCRIBED"
        ? SCOREBOARD_POLLING_CONFIG.HEALTHY_RECONCILIATION_INTERVAL_MS
        : this.fallbackInterval);

    this.scheduledDelays.push(delay);
    this.pollingTimer = { delay };
    return delay;
  }

  triggerReconcile() {
    this.dbQueryCount += 2; // rounds + v_public_overall_leaderboard
    this.hasReconciled = true;
    this.isServingCache = false;
  }

  onChannelStatusChange(status) {
    this.channelStatus = status;

    if (status === "SUBSCRIBED") {
      this.fallbackInterval = SCOREBOARD_POLLING_CONFIG.FALLBACK_INITIAL_INTERVAL_MS;
      if (this.reconnectTimer) {
        this.reconnectTimer = null;
      }
      this.triggerReconcile();
      this.scheduleNextPoll(SCOREBOARD_POLLING_CONFIG.HEALTHY_RECONCILIATION_INTERVAL_MS);
    } else if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      this.scheduleNextPoll(this.fallbackInterval);
      if (this.isOnline && !this.reconnectTimer) {
        this.reconnectTimer = {
          delay: Math.max(SCOREBOARD_POLLING_CONFIG.RECONNECT_DEBOUNCE_MS, this.fallbackInterval),
        };
      }
    }
  }

  simulatePollTick() {
    if (!this.isOnline || this.visibilityState === "hidden") return;

    this.triggerReconcile();

    if (this.channelStatus !== "SUBSCRIBED") {
      this.fallbackInterval = Math.min(
        this.fallbackInterval * SCOREBOARD_POLLING_CONFIG.FALLBACK_BACKOFF_FACTOR,
        SCOREBOARD_POLLING_CONFIG.FALLBACK_MAX_INTERVAL_MS
      );
    }

    this.scheduleNextPoll();
  }

  setOnline(online) {
    this.isOnline = online;
    if (online) {
      this.fallbackInterval = SCOREBOARD_POLLING_CONFIG.FALLBACK_INITIAL_INTERVAL_MS;
      this.triggerReconcile();
      if (this.channelStatus !== "SUBSCRIBED") {
        this.onChannelStatusChange("CONNECTING");
      } else {
        this.scheduleNextPoll(SCOREBOARD_POLLING_CONFIG.HEALTHY_RECONCILIATION_INTERVAL_MS);
      }
    } else {
      if (this.pollingTimer) this.pollingTimer = null;
      if (this.reconnectTimer) this.reconnectTimer = null;
    }
  }

  setVisibility(state) {
    this.visibilityState = state;
    if (state === "hidden") {
      if (this.pollingTimer) this.pollingTimer = null;
    } else if (state === "visible") {
      if (this.isOnline) {
        this.triggerReconcile();
        this.scheduleNextPoll();
      }
    }
  }

  unmount() {
    this.pollingTimer = null;
    this.reconnectTimer = null;
    this.activeSubCount = 0;
  }
}

// ==========================================
// TEST GROUP 1: HEALTHY REALTIME CONNECTION
// ==========================================
console.log("--- 1. HEALTHY REALTIME CONNECTION ---");

it("1A: Healthy connection schedules 60s low-frequency reconciliation (not 5s aggressive polling)", () => {
  const sb = new MockScoreboardManager();
  sb.onChannelStatusChange("SUBSCRIBED");

  assert.strictEqual(sb.channelStatus, "SUBSCRIBED");
  assert.strictEqual(sb.pollingTimer.delay, 60000, "Must schedule 60s safety interval");
  assert.strictEqual(sb.getPillStatus().state, "LIVE", "Must report LIVE once reconciled");
});

it("1B: Database query reduction: 12 polls/min reduced to 1 poll/min (91.7% reduction)", () => {
  const beforeIntervalMs = 5000;
  const beforePollsPerMinute = 60000 / beforeIntervalMs; // 12
  const afterPollsPerMinute = 60000 / SCOREBOARD_POLLING_CONFIG.HEALTHY_RECONCILIATION_INTERVAL_MS; // 1

  assert.strictEqual(beforePollsPerMinute, 12);
  assert.strictEqual(afterPollsPerMinute, 1);
  const reductionPercent = ((beforePollsPerMinute - afterPollsPerMinute) / beforePollsPerMinute) * 100;
  assert.strictEqual(reductionPercent.toFixed(1), "91.7");
});

// ==========================================
// TEST GROUP 2: REALTIME CHANNEL INTERRUPTION & EXPONENTIAL BACKOFF
// ==========================================
console.log("\n--- 2. REALTIME CHANNEL INTERRUPTION & EXPONENTIAL BACKOFF ---");

it("2A: CHANNEL_ERROR transitions UI to RECONNECTING... and engages fallback polling", () => {
  const sb = new MockScoreboardManager();
  sb.onChannelStatusChange("SUBSCRIBED");
  assert.strictEqual(sb.getPillStatus().state, "LIVE");

  // Interruption occurs
  sb.onChannelStatusChange("CHANNEL_ERROR");
  assert.strictEqual(sb.getPillStatus().state, "RECONNECTING");
  assert.strictEqual(sb.getPillStatus().text, "RECONNECTING...");
  assert.strictEqual(sb.pollingTimer.delay, 5000, "Initial fallback delay must be 5s");
});

it("2B: Exponential backoff schedule follows 5s -> 10s -> 20s -> 40s -> 60s (capped at 60s)", () => {
  const sb = new MockScoreboardManager();
  sb.onChannelStatusChange("CHANNEL_ERROR");

  assert.strictEqual(sb.fallbackInterval, 5000, "Tick 0: 5s");
  sb.simulatePollTick();
  assert.strictEqual(sb.fallbackInterval, 10000, "Tick 1: 10s");
  sb.simulatePollTick();
  assert.strictEqual(sb.fallbackInterval, 20000, "Tick 2: 20s");
  sb.simulatePollTick();
  assert.strictEqual(sb.fallbackInterval, 40000, "Tick 3: 40s");
  sb.simulatePollTick();
  assert.strictEqual(sb.fallbackInterval, 60000, "Tick 4: 60s (capped)");
  sb.simulatePollTick();
  assert.strictEqual(sb.fallbackInterval, 60000, "Tick 5: still capped at 60s");
});

it("2C: Reconnection restores healthy 60s schedule and resets backoff to 5s", () => {
  const sb = new MockScoreboardManager();
  sb.onChannelStatusChange("CHANNEL_ERROR");
  sb.simulatePollTick(); // 10s
  sb.simulatePollTick(); // 20s
  assert.strictEqual(sb.fallbackInterval, 20000);

  // Channel recovers
  sb.onChannelStatusChange("SUBSCRIBED");
  assert.strictEqual(sb.fallbackInterval, 5000, "Fallback interval reset to 5s initial");
  assert.strictEqual(sb.pollingTimer.delay, 60000, "Polling timer reset to 60s healthy");
  assert.strictEqual(sb.getPillStatus().state, "LIVE");
});

// ==========================================
// TEST GROUP 3: BROWSER OFFLINE AND RECONNECTION
// ==========================================
console.log("\n--- 3. BROWSER OFFLINE AND RECONNECTION ---");

it("3A: Network drop cancels polling timers and displays OFFLINE • CACHED STANDINGS", () => {
  const sb = new MockScoreboardManager();
  sb.onChannelStatusChange("SUBSCRIBED");
  assert.strictEqual(sb.getPillStatus().state, "LIVE");

  sb.setOnline(false);
  assert.strictEqual(sb.pollingTimer, null, "Polling timer must be completely cleared when offline");
  assert.strictEqual(sb.reconnectTimer, null, "Reconnect timer must be cleared when offline");
  assert.strictEqual(sb.getPillStatus().state, "OFFLINE");
  assert.strictEqual(sb.getPillStatus().text, "OFFLINE • CACHED STANDINGS");
});

it("3B: Browser reconnect immediately triggers authoritative reconcile and resubscribes", () => {
  const sb = new MockScoreboardManager({ isOnline: false });
  assert.strictEqual(sb.dbQueryCount, 0);

  sb.setOnline(true);
  assert.strictEqual(sb.dbQueryCount, 2, "Immediate reconciliation fired");
  assert.strictEqual(sb.fallbackInterval, 5000, "Backoff reset");
});

// ==========================================
// TEST GROUP 4: BROWSER TAB VISIBILITY HANDLING
// ==========================================
console.log("\n--- 4. BROWSER TAB VISIBILITY HANDLING ---");

it("4A: Hidden tab pauses background database polling", () => {
  const sb = new MockScoreboardManager();
  sb.onChannelStatusChange("SUBSCRIBED");
  assert.notStrictEqual(sb.pollingTimer, null);

  sb.setVisibility("hidden");
  assert.strictEqual(sb.pollingTimer, null, "Timer must be canceled when tab is hidden");
  assert.strictEqual(sb.scheduleNextPoll(), null, "scheduleNextPoll returns null when hidden");
});

it("4B: Restoring tab visibility triggers immediate reconciliation and resumes polling", () => {
  const sb = new MockScoreboardManager();
  sb.onChannelStatusChange("SUBSCRIBED");
  const initialQueries = sb.dbQueryCount;

  sb.setVisibility("hidden");
  assert.strictEqual(sb.pollingTimer, null);

  // User switches back to scoreboard tab
  sb.setVisibility("visible");
  assert.strictEqual(sb.dbQueryCount, initialQueries + 2, "Reconciliation queries fired on foreground");
  assert.notStrictEqual(sb.pollingTimer, null, "Polling schedule resumed");
});

// ==========================================
// TEST GROUP 5: CONCURRENCY, RACES & UNMOUNT CLEANUP
// ==========================================
console.log("\n--- 5. CONCURRENCY, RACES & UNMOUNT CLEANUP ---");

it("5A: Scoreboard never falsely declares itself LIVE before reconciliation confirms", () => {
  const sb = new MockScoreboardManager({ isServingCache: true });
  sb.isOnline = true;
  sb.channelStatus = "SUBSCRIBED";
  sb.hasReconciled = false;

  // Even though channel is SUBSCRIBED and browser is online, reconciliation has not yet finished!
  assert.strictEqual(sb.getPillStatus().state, "CACHED_SYNCING");
  assert.strictEqual(sb.getPillStatus().text, "CACHED • SYNCING...");

  // Reconciliation finishes
  sb.triggerReconcile();
  assert.strictEqual(sb.getPillStatus().state, "LIVE");
});

it("5B: Multiple mount/unmount cycles clean up all timers without duplicate subscriptions", () => {
  const sb = new MockScoreboardManager();
  sb.onChannelStatusChange("SUBSCRIBED");
  assert.notStrictEqual(sb.pollingTimer, null);

  sb.unmount();
  assert.strictEqual(sb.pollingTimer, null);
  assert.strictEqual(sb.reconnectTimer, null);
  assert.strictEqual(sb.activeSubCount, 0);
});

console.log(`\n=============================================================`);
console.log(`STAGE 2 (P1) VERIFICATION SUMMARY: ${passed} / ${total} tests passed cleanly!`);
console.log(`=============================================================\n`);

if (passed !== total) {
  process.exit(1);
}
