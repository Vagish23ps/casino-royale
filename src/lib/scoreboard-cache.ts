import type { Event, EventSettings, Round, LeaderboardEntry } from "@/lib/types";

export const SCOREBOARD_CACHE_VERSION = 1;
const CACHE_PREFIX = "casino_royale_scoreboard_v1_";
const LAST_EVENT_KEY = "casino_royale_last_event_id";

export interface ScoreboardSnapshot {
  schemaVersion: number;
  eventId: string;
  event: Event | null;
  settings: EventSettings | null;
  activeRound: Round | null;
  leaderboard: LeaderboardEntry[];
  cachedAt: number;
}

export function getScoreboardCacheKey(eventId: string): string {
  return `${CACHE_PREFIX}${eventId}`;
}

export function getLastActiveEventId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LAST_EVENT_KEY);
  } catch {
    return null;
  }
}

export function setLastActiveEventId(eventId: string): void {
  if (typeof window === "undefined" || !eventId) return;
  try {
    localStorage.setItem(LAST_EVENT_KEY, eventId);
  } catch {
    // Ignored in restricted/quota storage
  }
}

function isValidLeaderboardEntry(entry: unknown): entry is LeaderboardEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.team_id === "string" &&
    e.team_id.length > 0 &&
    typeof e.team_name === "string" &&
    typeof e.total_score === "number" &&
    !Number.isNaN(e.total_score) &&
    typeof e.rank === "number"
  );
}

export function validateScoreboardSnapshot(data: unknown): ScoreboardSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const s = data as Record<string, unknown>;

  if (s.schemaVersion !== SCOREBOARD_CACHE_VERSION) return null;
  if (typeof s.eventId !== "string" || s.eventId.trim().length === 0) return null;
  if (typeof s.cachedAt !== "number" || Number.isNaN(s.cachedAt) || s.cachedAt <= 0) return null;
  if (!Array.isArray(s.leaderboard)) return null;

  // Validate every entry
  const validLeaderboard: LeaderboardEntry[] = [];
  for (const item of s.leaderboard) {
    if (isValidLeaderboardEntry(item)) {
      validLeaderboard.push({
        team_id: item.team_id,
        team_name: item.team_name,
        team_color: typeof item.team_color === "string" ? item.team_color : null,
        avatar_url: typeof item.avatar_url === "string" ? item.avatar_url : null,
        total_score: item.total_score,
        rank: item.rank,
      });
    } else {
      return null; // Reject corrupted entries
    }
  }

  return {
    schemaVersion: SCOREBOARD_CACHE_VERSION,
    eventId: s.eventId,
    event: (s.event as Event) || null,
    settings: (s.settings as EventSettings) || null,
    activeRound: (s.activeRound as Round) || null,
    leaderboard: validLeaderboard,
    cachedAt: s.cachedAt,
  };
}

export function loadScoreboardSnapshot(eventId?: string | null): ScoreboardSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const targetEventId = eventId || getLastActiveEventId();
    if (!targetEventId) return null;

    const raw = localStorage.getItem(getScoreboardCacheKey(targetEventId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const validated = validateScoreboardSnapshot(parsed);
    if (!validated) {
      // Clean up corrupted or outdated cache entry
      localStorage.removeItem(getScoreboardCacheKey(targetEventId));
      return null;
    }

    // Ensure event ID isolation
    if (eventId && validated.eventId !== eventId) {
      return null;
    }

    return validated;
  } catch {
    return null;
  }
}

export function saveScoreboardSnapshot(
  data: Omit<ScoreboardSnapshot, "schemaVersion">
): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (!data.eventId || !Array.isArray(data.leaderboard)) return false;

    const key = getScoreboardCacheKey(data.eventId);
    const existingRaw = localStorage.getItem(key);

    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        // Never overwrite a newer cached snapshot with older server or realtime data
        if (existing && typeof existing.cachedAt === "number" && existing.cachedAt > data.cachedAt) {
          return false;
        }
      } catch {
        // Overwrite corrupted entry
      }
    }

    const payload: ScoreboardSnapshot = {
      schemaVersion: SCOREBOARD_CACHE_VERSION,
      eventId: data.eventId,
      event: data.event,
      settings: data.settings,
      activeRound: data.activeRound,
      leaderboard: data.leaderboard,
      cachedAt: data.cachedAt,
    };

    localStorage.setItem(key, JSON.stringify(payload));
    setLastActiveEventId(data.eventId);
    return true;
  } catch {
    // Quota exceeded or private mode safe fallback
    return false;
  }
}

export function updateLeaderboardCacheScores(
  eventId: string,
  updatedScores: Record<string, number>,
  timestamp: number = Date.now()
): boolean {
  if (typeof window === "undefined" || !eventId) return false;
  try {
    const current = loadScoreboardSnapshot(eventId);
    if (!current) return false;

    // Reject older updates
    if (current.cachedAt > timestamp) return false;

    const newLeaderboard = current.leaderboard.map((item) => {
      const newScore = updatedScores[item.team_id];
      if (newScore !== undefined) {
        return { ...item, total_score: newScore };
      }
      return item;
    });

    // Recompute ranks based on authoritative scores
    newLeaderboard.sort((a, b) => b.total_score - a.total_score);
    newLeaderboard.forEach((item, idx) => {
      item.rank = idx + 1;
    });

    return saveScoreboardSnapshot({
      eventId,
      event: current.event,
      settings: current.settings,
      activeRound: current.activeRound,
      leaderboard: newLeaderboard,
      cachedAt: timestamp,
    });
  } catch {
    return false;
  }
}
