// src/lib/scoreboard-config.ts
// Configuration for Live Scoreboard Adaptive Polling & Connection Resilience (Stage 2 P1)

export const SCOREBOARD_POLLING_CONFIG = {
  /** Periodic safety reconciliation interval when Realtime is healthy (SUBSCRIBED) */
  HEALTHY_RECONCILIATION_INTERVAL_MS: 60_000, // 60 seconds (down from 5s aggressive polling)

  /** Initial polling interval when Realtime is unhealthy or reconnecting */
  FALLBACK_INITIAL_INTERVAL_MS: 5_000, // 5 seconds

  /** Exponential backoff multiplier for unhealthy Realtime polling */
  FALLBACK_BACKOFF_FACTOR: 2, // 5s -> 10s -> 20s -> 40s -> 60s

  /** Maximum cap for fallback polling interval */
  FALLBACK_MAX_INTERVAL_MS: 60_000, // 60 seconds maximum backoff

  /** Minimum delay between Realtime reconnection attempts */
  RECONNECT_DEBOUNCE_MS: 1_500, // 1.5 seconds debounce
} as const;

export type RealtimeConnectionStatus =
  | "CONNECTING"
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED";

export type ScoreboardConnectionState =
  | "LIVE"
  | "CACHED_SYNCING"
  | "RECONNECTING"
  | "OFFLINE";
