"use client";

import { useEffect, useState, useCallback, useRef, useLayoutEffect, useSyncExternalStore } from "react";
import Image from "next/image";
import {
  Crown,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  FastForward,
  Sparkles,
} from "lucide-react";
import { cn } from "cn";
import { createClient } from "@/lib/supabase/client";
import type { Event, EventSettings, Round, LeaderboardEntry, Team } from "@/lib/types";
import { CasinoBackground } from "./casino-background";
import { PodiumCard } from "./podium-card";
import { LeaderboardRow } from "./leaderboard-row";
import { BrandReveal } from "./brand-reveal";
import { casinoSound } from "./casino-sound";
import {
  saveScoreboardSnapshot,
  loadScoreboardSnapshot,
  updateLeaderboardCacheScores,
} from "@/lib/scoreboard-cache";
import {
  SCOREBOARD_POLLING_CONFIG,
  type RealtimeConnectionStatus,
} from "@/lib/scoreboard-config";

type LiveScoreboardProps = {
  initialEvent: Event | null;
  initialSettings: EventSettings | null;
  initialRound: Round | null;
  initialLeaderboard: LeaderboardEntry[];
  isPublicView?: boolean;
  headingFontClassName?: string;
};

type RankShiftInfo = {
  from: number;
  to: number;
  direction: "up" | "down";
};

// 5-State Sequential Scoreboard Animation Machine:
// STATE 1: SCORE_ROLLING       - Scores spin in-place; visual visualOrder frozen
// STATE 2: DIGITS_SETTLING     - Waiting for all affected reels to visually lock
// STATE 3: DIGITS_SETTLED      - All digits settled at latest scores; pause & determine rank change
// STATE 4: NAMEPLATE_SHUFFLING - Single shared identity wrapper slides between rank positions (FLIP)
// STATE 5: SETTLED             - Movement complete; reveal rank shift badges & celebrations
type ScoreboardAnimState =
  | "IDLE"
  | "SCORE_ROLLING"
  | "DIGITS_SETTLING"
  | "DIGITS_SETTLED"
  | "NAMEPLATE_SHUFFLING"
  | "SETTLED";

// Layout helpers for dynamic alignment of teams ranked 4th and below
function getRestContainerClass(count: number): string {
  if (count === 1) {
    return "flex justify-center w-full";
  }
  if (count >= 2 && count <= 5) {
    return "grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3.5 max-w-4xl mx-auto w-full";
  }
  return "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-2.5 max-h-48 sm:max-h-60 lg:max-h-68 overflow-y-auto admin-scroll pr-1.5 w-full";
}

function getRestItemClass(index: number, count: number): string {
  if (count === 1) {
    return "w-full max-w-md sm:max-w-lg";
  }
  if (count === 3 && index === 2) {
    return "sm:col-span-2 sm:max-w-md sm:mx-auto w-full";
  }
  if (count === 5 && index === 4) {
    return "sm:col-span-2 sm:max-w-md sm:mx-auto w-full";
  }
  if (count > 5 && count % 3 === 1 && index === count - 1) {
    return "lg:col-span-3 lg:max-w-md lg:mx-auto w-full";
  }
  return "w-full";
}

// React 19 Deterministic Hydration & Network Observers (useSyncExternalStore)
const emptySubscribe = () => () => {};

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : true;
}

function getServerOnlineSnapshot(): boolean {
  return true;
}

export function LiveScoreboard({
  initialEvent,
  initialSettings,
  initialRound,
  initialLeaderboard,
  isPublicView = false,
  headingFontClassName,
}: LiveScoreboardProps) {
  const [event, setEvent] = useState<Event | null>(initialEvent);
  const eventId = event?.id || initialEvent?.id || null;
  const eventRef = useRef<Event | null>(initialEvent);
  useEffect(() => {
    eventRef.current = event;
  }, [event]);

  const [settings, setSettings] = useState<EventSettings | null>(initialSettings);
  const settingsRef = useRef<EventSettings | null>(initialSettings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const [activeRound, setActiveRound] = useState<Round | null>(initialRound);
  const activeRoundRef = useRef<Round | null>(initialRound);
  useEffect(() => {
    activeRoundRef.current = activeRound;
  }, [activeRound]);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [crownCelebration, setCrownCelebration] = useState(false);
  const [rankShifts, setRankShifts] = useState<Record<string, RankShiftInfo>>({});
  const [isAudioMuted, setIsAudioMuted] = useState(true);

  // Connection & Adaptive Polling State (Deterministic Initial Hydration via useSyncExternalStore)
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const isOnline = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerOnlineSnapshot
  );
  const isOnlineRef = useRef<boolean>(true);
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  const [channelStatus, setChannelStatus] = useState<RealtimeConnectionStatus>("CONNECTING");
  const channelStatusRef = useRef<RealtimeConnectionStatus>("CONNECTING");
  useEffect(() => {
    channelStatusRef.current = channelStatus;
  }, [channelStatus]);

  const [hasReconciled, setHasReconciled] = useState<boolean>(false);
  const [isServingCache, setIsServingCache] = useState<boolean>(false);

  // Polling, Backoff, and Channel References
  const fallbackIntervalRef = useRef<number>(SCOREBOARD_POLLING_CONFIG.FALLBACK_INITIAL_INTERVAL_MS);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  // Brand Reveal Intro State
  const [showBrandIntro, setShowBrandIntro] = useState<boolean>(isPublicView);

  // 1. TEAMS CATALOG (Stable metadata keyed by team_id)
  const [teamsCatalog, setTeamsCatalog] = useState<Record<string, LeaderboardEntry>>(() => {
    const map: Record<string, LeaderboardEntry> = {};
    initialLeaderboard.forEach((t) => {
      map[t.team_id] = t;
    });
    return map;
  });

  // 2. AUTHORITATIVE SCORES (Direct store of latest score per team ID)
  const [teamScores, setTeamScores] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    initialLeaderboard.forEach((t) => {
      map[t.team_id] = t.total_score;
    });
    return map;
  });
  const teamScoresRef = useRef<Record<string, number>>({});

  // 3. VISUAL SLOT ORDER (Frozen during score roll, reordered strictly during shuffle)
  const [visualOrder, setVisualOrder] = useState<string[]>(() =>
    initialLeaderboard.map((t) => t.team_id)
  );
  const visualOrderRef = useRef<string[]>([]);

  // 4. ANIMATION STATE MACHINE
  const [animState, setAnimState] = useState<ScoreboardAnimState>("IDLE");
  const animStateRef = useRef<ScoreboardAnimState>("IDLE");

  const [isSlotSpinning, setIsSlotSpinning] = useState(false);
  const [isNameplateShuffling, setIsNameplateShuffling] = useState(false);
  const [shufflingTeamIds, setShufflingTeamIds] = useState<string[]>([]);
  const [affectedTeamIds, setAffectedTeamIds] = useState<string[]>([]);
  const affectedTeamIdsRef = useRef<string[]>([]);
  const [scoreDeltas, setScoreDeltas] = useState<Record<string, number>>({});
  const teamsCatalogRef = useRef<Record<string, LeaderboardEntry>>({});

  const spinTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pauseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rankResetTimerRef = useRef<NodeJS.Timeout | null>(null);

  // FLIP and sequencing refs
  const firstRectsRef = useRef<Record<string, DOMRect> | null>(null);
  const pendingShiftsRef = useRef<Record<string, RankShiftInfo> | null>(null);
  const settledTeamsRef = useRef<Set<string>>(new Set());

  // Historical reference tracking
  const prevLeaderId = useRef<string | null>(initialLeaderboard[0]?.team_id || null);
  const prevScoresRef = useRef<Record<string, number>>({});
  const isInitialMountRef = useRef<boolean>(true);
  const latestRequestIdRef = useRef<number>(0);
  const latestProcessedTimestampRef = useRef<number>(0);

  // Synchronize refs in effects to satisfy react-hooks/refs
  useEffect(() => {
    visualOrderRef.current = visualOrder;
  }, [visualOrder]);

  useEffect(() => {
    teamScoresRef.current = teamScores;
  }, [teamScores]);

  useEffect(() => {
    affectedTeamIdsRef.current = affectedTeamIds;
  }, [affectedTeamIds]);

  useEffect(() => {
    teamsCatalogRef.current = teamsCatalog;
  }, [teamsCatalog]);

  const updateAnimState = useCallback((state: ScoreboardAnimState) => {
    animStateRef.current = state;
    setAnimState(state);
  }, []);

  // Initialize catalogs on mount or initialLeaderboard change, with localStorage snapshot persistence/hydration
  useEffect(() => {
    const cached = loadScoreboardSnapshot(eventId);

    if (eventId && initialLeaderboard.length > 0) {
      // If we have a cached snapshot with newer authoritative timestamp than SSR initialLeaderboard,
      // preserve the newer cached state instead of regressing to stale SSR data
      if (cached && cached.cachedAt > latestProcessedTimestampRef.current && cached.leaderboard.length > 0) {
        setIsServingCache(false);
        latestProcessedTimestampRef.current = cached.cachedAt;
        const map: Record<string, LeaderboardEntry> = {};
        const scores: Record<string, number> = {};
        cached.leaderboard.forEach((t) => {
          map[t.team_id] = t;
          scores[t.team_id] = t.total_score;
          prevScoresRef.current[t.team_id] = t.total_score;
        });
        prevLeaderId.current = cached.leaderboard[0]?.team_id || null;
        teamScoresRef.current = scores;
        setTeamsCatalog((prev) => ({ ...prev, ...map }));
        setTeamScores(scores);
        const order = cached.leaderboard.map((t) => t.team_id);
        visualOrderRef.current = order;
        setVisualOrder(order);
        if (cached.activeRound) setActiveRound(cached.activeRound);
        return;
      }

      const catalogUpdates: Record<string, LeaderboardEntry> = {};
      initialLeaderboard.forEach((t) => {
        catalogUpdates[t.team_id] = t;
        prevScoresRef.current[t.team_id] = t.total_score;
      });
      setTeamsCatalog((prev) => ({ ...prev, ...catalogUpdates }));
      const now = Date.now();
      if (now > latestProcessedTimestampRef.current) {
        latestProcessedTimestampRef.current = now;
      }
      saveScoreboardSnapshot({
        eventId,
        event,
        settings,
        activeRound,
        leaderboard: initialLeaderboard,
        cachedAt: now,
      });
      setIsServingCache(false);
    } else {
      // If initial server data is empty (e.g. offline or failed initial load), check cache
      if (cached && cached.leaderboard.length > 0) {
        setIsServingCache(true);
        latestProcessedTimestampRef.current = cached.cachedAt;
        const map: Record<string, LeaderboardEntry> = {};
        const scores: Record<string, number> = {};
        cached.leaderboard.forEach((t) => {
          map[t.team_id] = t;
          scores[t.team_id] = t.total_score;
          prevScoresRef.current[t.team_id] = t.total_score;
        });
        prevLeaderId.current = cached.leaderboard[0]?.team_id || null;
        teamScoresRef.current = scores;
        setTeamsCatalog(map);
        setTeamScores(scores);
        const order = cached.leaderboard.map((t) => t.team_id);
        visualOrderRef.current = order;
        setVisualOrder(order);
        if (cached.activeRound) {
          setActiveRound(cached.activeRound);
        }
        if (cached.event && !event) {
          setEvent(cached.event);
        }
        if (cached.settings && !settings) {
          setSettings(cached.settings);
        }
      }
    }
  }, [eventId, event, settings, activeRound, initialLeaderboard]);

  // Handle immediate skip of the reveal sequence
  const handleSkipReveal = useCallback(() => {
    if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    if (rankResetTimerRef.current) clearTimeout(rankResetTimerRef.current);
    casinoSound.stopSlotRoll();

    // Reset any in-flight transforms on identity wrappers
    document.querySelectorAll<HTMLElement>("[data-team-identity]").forEach((el) => {
      el.style.transform = "";
      el.style.transition = "";
      el.style.zIndex = "";
    });

    // Immediately snap visual order to authoritative score ranking
    const allIds = Object.keys(teamsCatalogRef.current);
    const sorted = [...allIds].sort((a, b) => {
      const sa = teamScoresRef.current[a] ?? 0;
      const sb = teamScoresRef.current[b] ?? 0;
      return sb - sa;
    });

    visualOrderRef.current = sorted;
    setVisualOrder(sorted);
    setShowBrandIntro(false);
    setIsSlotSpinning(false);
    setIsNameplateShuffling(false);
    setShufflingTeamIds([]);
    updateAnimState("IDLE");
    setAffectedTeamIds([]);
    setScoreDeltas({});
  }, [updateAnimState]);

  const handleBrandRevealComplete = useCallback(() => {
    setShowBrandIntro(false);
  }, []);

  // STATE 4: Launch physical shuffle of the single identity wrapper (FLIP)
  const startIdentityShuffle = useCallback(
    (targetOrder: string[], newShifts: Record<string, RankShiftInfo>) => {
      // 1. FIRST: Measure bounding rects of the single identity wrapper per team
      const rects: Record<string, DOMRect> = {};
      document.querySelectorAll<HTMLElement>("[data-team-identity]").forEach((el) => {
        const id = el.getAttribute("data-team-identity");
        if (id) rects[id] = el.getBoundingClientRect();
      });

      firstRectsRef.current = rects;
      pendingShiftsRef.current = newShifts;

      setShufflingTeamIds(Object.keys(newShifts));
      setIsNameplateShuffling(true);
      updateAnimState("NAMEPLATE_SHUFFLING");

      // 2. LAST: Apply target visual order to React state (DOM will place elements into new slots)
      visualOrderRef.current = targetOrder;
      setVisualOrder(targetOrder);
    },
    [updateAnimState]
  );

  // STATE 3: Invoked when ALL affected slot score reels have settled completely
  const handleAllReelsSettled = useCallback(() => {
    if (animStateRef.current !== "SCORE_ROLLING") return;
    setIsSlotSpinning(false);
    casinoSound.stopSlotRoll();
    updateAnimState("DIGITS_SETTLED");

    // Compute target ranking order based on current authoritative scores
    const currentOrder = visualOrderRef.current;
    const sorted = [...currentOrder].sort((a, b) => {
      const sa = teamScoresRef.current[a] ?? 0;
      const sb = teamScoresRef.current[b] ?? 0;
      return sb - sa;
    });

    // Check if visual ordering changed
    let orderChanged = false;
    const newShifts: Record<string, RankShiftInfo> = {};

    currentOrder.forEach((teamId, oldIdx) => {
      const newIdx = sorted.indexOf(teamId);
      const oldRank = oldIdx + 1;
      const newRank = newIdx >= 0 ? newIdx + 1 : oldRank;
      if (oldRank !== newRank) {
        orderChanged = true;
        newShifts[teamId] = {
          from: oldRank,
          to: newRank,
          direction: newRank < oldRank ? "up" : "down",
        };
      }
    });

    if (!orderChanged) {
      // Score updated, but ranking order unchanged: keep teams in place without shuffle!
      updateAnimState("SETTLED");
      if (rankResetTimerRef.current) clearTimeout(rankResetTimerRef.current);
      rankResetTimerRef.current = setTimeout(() => {
        setAffectedTeamIds([]);
        setScoreDeltas({});
        updateAnimState("IDLE");
      }, 3500);
      return;
    }

    // Rank order CHANGED! Give 350ms satisfying pause with settled score numbers before shuffle starts
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      startIdentityShuffle(sorted, newShifts);
    }, 350);
  }, [updateAnimState, startIdentityShuffle]);

  // STATE 2: Settled detection callback from individual score reels
  const handleReelSettled = useCallback(
    (teamId: string) => {
      settledTeamsRef.current.add(teamId);
      if (
        affectedTeamIdsRef.current.length > 0 &&
        affectedTeamIdsRef.current.every((id) => settledTeamsRef.current.has(id))
      ) {
        if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
        handleAllReelsSettled();
      }
    },
    [handleAllReelsSettled]
  );

  // STATE 4 FLIP: Move the SINGLE identity wrapper with shared transform
  useLayoutEffect(() => {
    if (animState !== "NAMEPLATE_SHUFFLING" || !firstRectsRef.current) return;

    const firstRects = firstRectsRef.current;
    firstRectsRef.current = null;

    const movingWrappers: { el: HTMLElement; isUp: boolean; dx: number; dy: number }[] = [];

    // Phase 1: BATCH READ (measure all bounding boxes in one contiguous pass without mutating DOM styles)
    document.querySelectorAll<HTMLElement>("[data-team-identity]").forEach((el) => {
      const id = el.getAttribute("data-team-identity");
      if (!id || !firstRects[id]) return;

      const first = firstRects[id];
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        const shift = pendingShiftsRef.current?.[id];
        const isUp = shift?.direction === "up";
        movingWrappers.push({ el, isUp, dx, dy });
      }
    });

    if (movingWrappers.length === 0) {
      setIsNameplateShuffling(false);
      setShufflingTeamIds([]);
      updateAnimState("SETTLED");
      return;
    }

    // Phase 2: BATCH WRITE (apply hardware-accelerated invert transforms in a single contiguous write pass)
    movingWrappers.forEach(({ el, isUp, dx, dy }) => {
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      el.style.transition = "none";
      el.style.zIndex = isUp ? "60" : "40";
    });

    // PLAY: Animate the single identity wrapper to final position with GPU acceleration
    const animFrame = requestAnimationFrame(() => {
      casinoSound.playNameplateShuffle();
      casinoSound.playScoreReveal(true);

      movingWrappers.forEach(({ el }) => {
        el.style.transition = "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "translate3d(0px, 0px, 0)";
      });
    });

    const slideDurationMs = 680;
    const timeout = setTimeout(() => {
      // Settle complete: clean up inline transform and z-index styles
      movingWrappers.forEach(({ el }) => {
        el.style.transform = "";
        el.style.transition = "";
        el.style.zIndex = "";
      });

      setIsNameplateShuffling(false);
      setShufflingTeamIds([]);
      updateAnimState("SETTLED");

      // STATE 5: Reveal Rank Indicators after identity wrappers have settled
      if (pendingShiftsRef.current) {
        setRankShifts(pendingShiftsRef.current);
        pendingShiftsRef.current = null;
      }

      // Check if champion changed
      const currentTopId = visualOrderRef.current[0];
      if (currentTopId && prevLeaderId.current && currentTopId !== prevLeaderId.current) {
        setCrownCelebration(true);
        casinoSound.playChampionFanfare();
        setTimeout(() => setCrownCelebration(false), 5500);
      }
      prevLeaderId.current = currentTopId || null;

      if (rankResetTimerRef.current) clearTimeout(rankResetTimerRef.current);
      rankResetTimerRef.current = setTimeout(() => {
        setRankShifts({});
        setAffectedTeamIds([]);
        setScoreDeltas({});
        updateAnimState("IDLE");
      }, 3500);
    }, slideDurationMs);

    return () => {
      cancelAnimationFrame(animFrame);
      clearTimeout(timeout);
    };
  }, [animState, visualOrder, updateAnimState]);

  // UNIFIED AUTHORITATIVE SCORE APPLICATOR
  // Sets authoritative scores directly by stable team ID while freezing visualOrder
  const applyAuthoritativeScores = useCallback(
    (
      newScores: Record<string, number>,
      affected: string[],
      deltas: Record<string, number>,
      authoritativeTimestamp?: number
    ) => {
      const authTime = authoritativeTimestamp || Date.now();
      if (authTime >= latestProcessedTimestampRef.current) {
        latestProcessedTimestampRef.current = authTime;
      }

      // Update authoritative scores store
      teamScoresRef.current = { ...teamScoresRef.current, ...newScores };
      setTeamScores((prev) => ({ ...prev, ...newScores }));

      // Safely schedule non-blocking cache update with authoritative absolute scores
      if (typeof window !== "undefined" && eventId) {
        const scheduleWrite =
          typeof window.requestIdleCallback === "function"
            ? window.requestIdleCallback
            : (cb: () => void) => setTimeout(cb, 50);
        scheduleWrite(() => {
          updateLeaderboardCacheScores(eventId, newScores, authTime);
        });
      }

      // Freeze visualOrder in current positions, start score rolling (STATE 1)
      settledTeamsRef.current.clear();
      affectedTeamIdsRef.current = affected;
      setAffectedTeamIds(affected);
      setScoreDeltas(deltas);
      setIsSlotSpinning(true);
      updateAnimState("SCORE_ROLLING");
      casinoSound.startSlotRoll(1600);

      // Fallback timer (3500ms) only fires if callbacks fail to complete
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
      spinTimerRef.current = setTimeout(() => {
        handleAllReelsSettled();
      }, 3500);
    },
    [eventId, updateAnimState, handleAllReelsSettled]
  );

  // Fetch latest leaderboard and round directly from Supabase view (authoritative source of truth)
  const refreshLeaderboard = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    const requestStartTime = Date.now();
    try {
      const supabase = createClient();

      // 1 & 2. Concurrently fetch active round and overall leaderboard (parallel client queries)
      let rndQuery = supabase
        .from("rounds")
        .select("*")
        .eq("status", "active")
        .is("deleted_at", null);

      let lbQuery = supabase
        .from("v_public_overall_leaderboard")
        .select("*");

      if (eventId) {
        rndQuery = rndQuery.eq("event_id", eventId);
        lbQuery = lbQuery.eq("event_id", eventId);
      }

      const rndPromise = rndQuery
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lbPromise = lbQuery.order("rank", { ascending: true });

      const [rndResult, lbResult] = await Promise.all([rndPromise, lbPromise]);

      if (requestId !== latestRequestIdRef.current) return;
      if (latestProcessedTimestampRef.current > requestStartTime) return;

      if (rndResult.data) {
        setActiveRound(rndResult.data as Round);
      }

      const viewData = lbResult.data;
      const error = lbResult.error;

      if (requestId !== latestRequestIdRef.current) return;
      if (latestProcessedTimestampRef.current > requestStartTime) return;

      let nextLeaderboard: LeaderboardEntry[] = [];

      if (!error && viewData && viewData.length > 0) {
        nextLeaderboard = (viewData as Record<string, unknown>[]).map((d) => ({
          team_id: String(d.team_id || ""),
          team_name: String(d.team_name || ""),
          team_color: typeof d.team_color === "string" ? d.team_color : null,
          avatar_url: typeof d.avatar_url === "string" ? d.avatar_url : null,
          total_score: Number(d.total_score || 0),
          rank: Number(d.rank || 1),
        }));
      } else {
        // Fallback: direct team list with starting score (scoped to eventId)
        let tQuery = supabase
          .from("teams")
          .select("*")
          .is("deleted_at", null);
        if (eventId) {
          tQuery = tQuery.eq("event_id", eventId);
        }
        const { data: tData } = await tQuery;

        if (requestId !== latestRequestIdRef.current) return;

        if (tData && tData.length > 0) {
          const startingScore = Number(settingsRef.current?.starting_score || 0.0);
          nextLeaderboard = (tData as Team[]).map((team, idx) => ({
            team_id: team.id,
            team_name: team.name,
            team_color: team.color,
            avatar_url: team.avatar_url,
            total_score: startingScore,
            rank: idx + 1,
          }));
        }
      }

      if (nextLeaderboard.length === 0) return;
      if (requestId !== latestRequestIdRef.current) return;
      if (latestProcessedTimestampRef.current > requestStartTime) return;

      // Update teams catalog with any new metadata
      setTeamsCatalog((prev) => {
        const next = { ...prev };
        nextLeaderboard.forEach((t) => {
          next[t.team_id] = t;
        });
        return next;
      });

      // Persist latest authoritative snapshot to cache and mark live synced
      if (eventId) {
        saveScoreboardSnapshot({
          eventId,
          event: eventRef.current,
          settings: settingsRef.current,
          activeRound: rndResult.data ? (rndResult.data as Round) : activeRoundRef.current,
          leaderboard: nextLeaderboard,
          cachedAt: requestStartTime,
        });
        setHasReconciled(true);
        setIsServingCache(false);
      }

      // On initial cold mount, establish baseline
      if (isInitialMountRef.current) {
        isInitialMountRef.current = false;
        const initialMap: Record<string, number> = {};
        nextLeaderboard.forEach((t) => {
          initialMap[t.team_id] = t.total_score;
          prevScoresRef.current[t.team_id] = t.total_score;
        });
        prevLeaderId.current = nextLeaderboard[0]?.team_id || null;
        teamScoresRef.current = initialMap;
        setTeamScores(initialMap);
        const initialOrder = nextLeaderboard.map((t) => t.team_id);
        visualOrderRef.current = initialOrder;
        setVisualOrder(initialOrder);
        setHasReconciled(true);
        setIsServingCache(false);
        return;
      }

      // If animation is in-flight, do not disrupt visual slots
      if (animStateRef.current !== "IDLE" && animStateRef.current !== "SETTLED") {
        return;
      }

      // Check which teams received actual score changes
      const affected: string[] = [];
      const deltas: Record<string, number> = {};
      const newScores: Record<string, number> = {};

      nextLeaderboard.forEach((team) => {
        const currentScore = teamScoresRef.current[team.team_id] ?? prevScoresRef.current[team.team_id];
        if (currentScore !== undefined && currentScore !== team.total_score) {
          affected.push(team.team_id);
          deltas[team.team_id] = team.total_score - currentScore;
        }
        prevScoresRef.current[team.team_id] = team.total_score;
        newScores[team.team_id] = team.total_score;
      });

      if (affected.length > 0) {
        applyAuthoritativeScores(newScores, affected, deltas);
      } else {
        // If scores are unchanged but metadata or teams list changed, update catalog
        setVisualOrder((prev) => {
          if (prev.length === 0) return nextLeaderboard.map((t) => t.team_id);
          return prev;
        });
      }
    } catch {
      // Handled gracefully
    }
  }, [eventId, applyAuthoritativeScores]);

  // Connection-aware adaptive polling scheduler (Stage 2 P1)
  const scheduleNextPollRef = useRef<(customDelay?: number) => void>(() => {});
  const setupRealtimeSubscriptionRef = useRef<() => void>(() => {});

  const scheduleNextPoll = useCallback(
    (customDelay?: number) => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }

      // Stop network polling when offline or when document is hidden
      if (!isOnlineRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      const delay =
        customDelay ??
        (channelStatusRef.current === "SUBSCRIBED"
          ? SCOREBOARD_POLLING_CONFIG.HEALTHY_RECONCILIATION_INTERVAL_MS
          : fallbackIntervalRef.current);

      pollingTimerRef.current = setTimeout(async () => {
        pollingTimerRef.current = null;
        if (!isOnlineRef.current || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
          return;
        }

        await refreshLeaderboard();

        // If Realtime remains unhealthy, apply exponential backoff
        if (channelStatusRef.current !== "SUBSCRIBED") {
          fallbackIntervalRef.current = Math.min(
            fallbackIntervalRef.current * SCOREBOARD_POLLING_CONFIG.FALLBACK_BACKOFF_FACTOR,
            SCOREBOARD_POLLING_CONFIG.FALLBACK_MAX_INTERVAL_MS
          );
        }

        scheduleNextPollRef.current();
      }, delay);
    },
    [refreshLeaderboard]
  );

  useEffect(() => {
    scheduleNextPollRef.current = scheduleNextPoll;
  }, [scheduleNextPoll]);

  // Realtime subscription setup with full lifecycle and reconnection handling
  const setupRealtimeSubscription = useCallback(() => {
    if (channelRef.current) {
      try {
        const supabase = createClient();
        supabase.removeChannel(channelRef.current);
      } catch {
        // Channel removal safe fallback
      }
      channelRef.current = null;
    }

    if (!isOnlineRef.current) {
      channelStatusRef.current = "CLOSED";
      return;
    }

    channelStatusRef.current = "CONNECTING";

    try {
      const supabase = createClient();
      const channelName = eventId ? `scoreboard:${eventId}` : "public-scoreboard-realtime";

      const channel = supabase
        .channel(channelName)
        .on("broadcast", { event: "score_update" }, (message) => {
          const payload = message?.payload;
          if (payload?.eventId && eventId && payload.eventId !== eventId) {
            return;
          }
          if (payload?.timestamp && payload.timestamp < latestProcessedTimestampRef.current) {
            return;
          }
          if (payload?.timestamp) {
            latestProcessedTimestampRef.current = payload.timestamp;
          }

          // Extract authoritative resulting scores from broadcast payload
          const directScores: Record<string, number> = {};
          if (payload?.updated_scores && typeof payload.updated_scores === "object") {
            Object.entries(payload.updated_scores).forEach(([tId, s]) => {
              directScores[tId] = Number(s);
            });
          } else if (payload?.teamId && payload.resulting_score !== undefined) {
            directScores[payload.teamId] = Number(payload.resulting_score);
          }

          if (Object.keys(directScores).length > 0) {
            const affected: string[] = [];
            const deltas: Record<string, number> = {};
            const newScores: Record<string, number> = { ...teamScoresRef.current };

            Object.entries(directScores).forEach(([teamId, s]) => {
              const currentScore = teamScoresRef.current[teamId] ?? prevScoresRef.current[teamId];
              if (currentScore === undefined || currentScore !== s) {
                affected.push(teamId);
                deltas[teamId] = s - (currentScore ?? s);
              }
              prevScoresRef.current[teamId] = s;
              newScores[teamId] = s;
            });

            if (affected.length > 0) {
              applyAuthoritativeScores(newScores, affected, deltas, payload?.timestamp);
            }
          } else {
            refreshLeaderboard();
          }
        })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "teams" },
          () => {
            refreshLeaderboard();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rounds" },
          () => {
            refreshLeaderboard();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "event_settings" },
          () => {
            refreshLeaderboard();
          }
        )
        .subscribe((status) => {
          const currentStatus = status as RealtimeConnectionStatus;
          channelStatusRef.current = currentStatus;
          setChannelStatus(currentStatus);

          if (currentStatus === "SUBSCRIBED") {
            // Healthy Realtime connection confirmed
            fallbackIntervalRef.current = SCOREBOARD_POLLING_CONFIG.FALLBACK_INITIAL_INTERVAL_MS;
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            // Authoritative server reconciliation
            refreshLeaderboard().then(() => {
              scheduleNextPollRef.current(SCOREBOARD_POLLING_CONFIG.HEALTHY_RECONCILIATION_INTERVAL_MS);
            });
          } else if (
            currentStatus === "CHANNEL_ERROR" ||
            currentStatus === "TIMED_OUT" ||
            currentStatus === "CLOSED"
          ) {
            // Unhealthy Realtime: activate fallback exponential backoff polling
            scheduleNextPollRef.current(fallbackIntervalRef.current);

            // Debounced subscription retry if browser is online
            if (isOnlineRef.current && !reconnectTimerRef.current) {
              reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                if (isOnlineRef.current && channelStatusRef.current !== "SUBSCRIBED") {
                  setupRealtimeSubscriptionRef.current();
                }
              }, Math.max(SCOREBOARD_POLLING_CONFIG.RECONNECT_DEBOUNCE_MS, fallbackIntervalRef.current));
            }
          }
        });

      channelRef.current = channel;
    } catch {
      channelStatusRef.current = "CHANNEL_ERROR";
      scheduleNextPollRef.current(fallbackIntervalRef.current);
    }
  }, [eventId, refreshLeaderboard, applyAuthoritativeScores]);

  useEffect(() => {
    setupRealtimeSubscriptionRef.current = setupRealtimeSubscription;
  }, [setupRealtimeSubscription]);

  // Realtime subscription lifecycle & unmount timer cleanup
  useEffect(() => {
    setupRealtimeSubscription();

    return () => {
      if (channelRef.current) {
        try {
          const supabase = createClient();
          supabase.removeChannel(channelRef.current);
        } catch {
          // Safe ignore
        }
        channelRef.current = null;
      }
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (rankResetTimerRef.current) clearTimeout(rankResetTimerRef.current);
      casinoSound.stopSlotRoll();
    };
  }, [setupRealtimeSubscription]);

  // Online / offline network connectivity monitoring side-effects
  useEffect(() => {
    const handleOnline = () => {
      isOnlineRef.current = true;
      fallbackIntervalRef.current = SCOREBOARD_POLLING_CONFIG.FALLBACK_INITIAL_INTERVAL_MS;

      // Reconcile authoritative data immediately upon reconnection
      refreshLeaderboard();

      if (channelStatusRef.current !== "SUBSCRIBED") {
        setupRealtimeSubscription();
      } else {
        scheduleNextPoll(SCOREBOARD_POLLING_CONFIG.HEALTHY_RECONCILIATION_INTERVAL_MS);
      }
    };

    const handleOffline = () => {
      isOnlineRef.current = false;

      // Stop all background polling and reconnect attempts when offline
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshLeaderboard, scheduleNextPoll, setupRealtimeSubscription]);

  // Tab visibility change monitoring (document.visibilityState)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Tab backgrounded: pause polling timers to conserve network bandwidth
        if (pollingTimerRef.current) {
          clearTimeout(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
      } else if (document.visibilityState === "visible") {
        // Tab foregrounded: reconcile any updates missed while hidden
        if (isOnlineRef.current) {
          refreshLeaderboard();
          scheduleNextPoll();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshLeaderboard, scheduleNextPoll]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // Keyboard shortcut listener ('F' key for projector presentation mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleFullscreen]);

  const toggleAudio = () => {
    const isMuted = casinoSound.toggleMute();
    setIsAudioMuted(isMuted);
  };

  const top1Id = visualOrder[0] || null;
  const top2Id = visualOrder[1] || null;
  const top3Id = visualOrder[2] || null;
  const restIds = visualOrder.slice(3);

  const top1 = top1Id ? teamsCatalog[top1Id] || null : null;
  const top2 = top2Id ? teamsCatalog[top2Id] || null : null;
  const top3 = top3Id ? teamsCatalog[top3Id] || null : null;

  // Deterministic connection status for hydration and live states
  const getPillStatus = () => {
    // 1. Initial hydration pass and SSR: deterministic markup (never reads browser APIs or socket)
    if (!isMounted) {
      return {
        dotColor: "bg-sky-400 animate-pulse",
        text: initialLeaderboard && initialLeaderboard.length > 0
          ? "CACHED • SYNCING..."
          : "SYNCING...",
      };
    }

    // 2. Offline: browser network connectivity is unavailable
    if (!isOnline) {
      return {
        dotColor: "bg-amber-400",
        text: "OFFLINE • CACHED STANDINGS",
      };
    }

    // 3. Realtime connection unavailable or interrupted
    if (channelStatus !== "SUBSCRIBED") {
      // While initial connection handshake & reconciliation are in progress, show CACHED • SYNCING...
      if (!hasReconciled && channelStatus === "CONNECTING") {
        return {
          dotColor: "bg-sky-400 animate-pulse",
          text: isServingCache || (initialLeaderboard && initialLeaderboard.length > 0)
            ? "CACHED • SYNCING..."
            : "SYNCING...",
        };
      }
      return {
        dotColor: "bg-amber-400 animate-pulse",
        text: "RECONNECTING...",
      };
    }

    // 4. Subscribed, but awaiting initial authoritative reconciliation or serving stale cached standings
    if (isServingCache || !hasReconciled) {
      return {
        dotColor: "bg-sky-400 animate-pulse",
        text: "CACHED • SYNCING...",
      };
    }

    // 5. LIVE: confirmed Realtime subscription and reconciled authoritative data
    return {
      dotColor: "bg-emerald-400 animate-pulse",
      text: activeRound
        ? `Round ${activeRound.round_number}: ${activeRound.name}`
        : "Round 1: Main Event",
    };
  };

  const pillStatus = getPillStatus();

  return (
    <div className="h-screen w-screen max-h-screen overflow-hidden bg-[#050508] text-foreground flex flex-col justify-between p-3 sm:p-5 lg:p-6 select-none relative font-sans">
      {/* 1. IMMERSIVE CASINO ENVIRONMENT BACKGROUND */}
      <CasinoBackground isCelebration={crownCelebration} />

      {/* 2. REFINED POWERHOUSE & CASINO ROYALE BRAND REVEAL INTRO */}
      {showBrandIntro && (
        <BrandReveal
          onComplete={handleBrandRevealComplete}
          headingFontClassName={headingFontClassName}
        />
      )}

      {/* Top Controls: Brand Intro, Audio Sound Toggle, Skip Reveal (if active) & Fullscreen Mode */}
      <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
        {(isSlotSpinning || isNameplateShuffling) && (
          <button
            onClick={handleSkipReveal}
            title="Skip to final scores"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 hover:bg-black/70 text-neutral-400 hover:text-neutral-200 border border-white/10 text-xs font-mono uppercase tracking-wider backdrop-blur-sm transition-colors cursor-pointer"
          >
            <FastForward className="w-3.5 h-3.5" />
            <span>Skip Reveal</span>
          </button>
        )}

        <button
          onClick={() => setShowBrandIntro(true)}
          title="Replay Brand Reveal Intro"
          className="p-2 rounded-lg bg-black/40 hover:bg-black/70 text-neutral-400 hover:text-neutral-200 border border-white/5 hover:border-white/15 backdrop-blur-sm transition-colors cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
        </button>

        <button
          onClick={toggleAudio}
          title={isAudioMuted ? "Enable Casino Audio" : "Mute Casino Audio"}
          className="p-2 rounded-lg bg-black/40 hover:bg-black/70 text-neutral-400 hover:text-neutral-200 border border-white/5 hover:border-white/15 backdrop-blur-sm transition-colors cursor-pointer"
        >
          {isAudioMuted ? (
            <VolumeX className="w-4 h-4 text-neutral-500" />
          ) : (
            <Volume2 className="w-4 h-4 text-neutral-300" />
          )}
        </button>

        <button
          onClick={toggleFullscreen}
          title="Toggle Fullscreen Presentation (or press 'F')"
          className="p-2 rounded-lg bg-black/40 hover:bg-black/70 text-neutral-400 hover:text-neutral-200 border border-white/5 hover:border-white/15 backdrop-blur-sm transition-colors cursor-pointer"
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      </div>

      {/* HEADER: PowerHouse Logo, Casino Royale Heading & Live Status */}
      <header className="relative z-20 flex flex-col items-center text-center space-y-1.5 pb-1 shrink-0">
        <div className="flex items-center justify-center gap-3 sm:gap-4.5">
          {isPublicView ? (
            <div className="relative shrink-0 flex items-center justify-center rounded-lg overflow-hidden bg-black shadow-xl border border-red-950/40 p-0.5">
              <Image
                src="/powerhouse-logo.png"
                alt="PowerHouse"
                width={319}
                height={249}
                className="h-8 sm:h-11 lg:h-13 w-auto object-contain"
                priority
              />
            </div>
          ) : (
            <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gold/15 border border-gold/40 shadow-[0_0_15px_rgba(212,168,67,0.25)]">
              <Crown className="w-4 h-4 text-gold" />
            </div>
          )}

          <h1
            className={cn(
              "text-2xl sm:text-4xl lg:text-5xl text-foreground uppercase drop-shadow-[0_2px_14px_rgba(212,168,67,0.35)] transition-all",
              isPublicView
                ? `${headingFontClassName || "font-serif"} font-normal tracking-[0.2em] sm:tracking-[0.25em]`
                : "font-black tracking-widest font-serif"
            )}
          >
            CASINO ROYALE
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Smooth Round Indicator Pill / Connection Health Status */}
          <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-[#120a10]/85 border border-gold/35 text-xs sm:text-sm tracking-widest text-gold uppercase font-bold backdrop-blur-md shadow-md transition-all duration-500">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                pillStatus.dotColor
              )}
            />
            <span>{pillStatus.text}</span>
          </div>

          {/* Slot Machine Reveal Status Pill */}
          {isSlotSpinning && (
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-gold/25 border border-gold/60 text-[10px] sm:text-xs tracking-widest text-gold-bright uppercase font-mono font-bold backdrop-blur-md shadow-md animate-pulse">
              <span>🎰</span>
              <span>REELS SPINNING</span>
            </div>
          )}

          {/* Nameplate Shuffle Status Pill */}
          {isNameplateShuffling && (
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-500/60 text-[10px] sm:text-xs tracking-widest text-emerald-300 uppercase font-mono font-bold backdrop-blur-md shadow-md animate-pulse">
              <span>⇄</span>
              <span>NAMEPLATES SHUFFLING</span>
            </div>
          )}
        </div>
      </header>

      {/* DEDICATED LAYOUT REGION: CHAMPION ANNOUNCEMENT BANNER */}
      <div
        className={cn(
          "w-full max-w-xl mx-auto px-4 overflow-hidden transition-all duration-700 ease-out shrink-0 z-30",
          crownCelebration && top1
            ? "max-h-16 opacity-100 my-1 sm:my-2"
            : "max-h-0 opacity-0 my-0 pointer-events-none"
        )}
      >
        <div className="flex items-center justify-center gap-2.5 px-6 py-2 rounded-2xl bg-gradient-to-r from-[#7f1d1d]/95 via-[#f0c85a]/40 to-[#7f1d1d]/95 border-2 border-gold shadow-[0_0_35px_rgba(240,200,90,0.7)] backdrop-blur-xl text-center">
          <Crown className="w-5 h-5 text-gold-bright animate-bounce shrink-0" />
          <span className="font-serif font-black text-xs sm:text-sm lg:text-base text-gold-bright tracking-widest uppercase drop-shadow-md">
            NEW CHAMPION: {top1?.team_name} • TAKES 1ST PLACE
          </span>
          <Crown className="w-5 h-5 text-gold-bright animate-bounce shrink-0" />
        </div>
      </div>

      {/* MAIN STAGE: 3D Casino Podium + Remaining Teams Standings */}
      <main className="flex-1 flex flex-col justify-center my-auto relative z-20 max-w-6xl mx-auto w-full">
        {visualOrder.length === 0 ? (
          /* ELEGANT AWAITING SCORES STATE */
          <div className="flex flex-col items-center justify-center text-center py-10 px-6 space-y-5 rounded-3xl border border-gold/30 bg-card/60 backdrop-blur-xl max-w-md mx-auto shadow-[0_0_40px_rgba(0,0,0,0.8)] relative overflow-hidden animate-podium-in">
            <div className="relative w-28 h-28 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-dashed border-gold/50 animate-spin-chip-rev" />
              <div className="absolute inset-2.5 rounded-full border border-[#00e5ff]/50 animate-spin-chip" />
              <div className="w-14 h-14 rounded-full bg-gradient-to-b from-[#2a0e14] to-[#08080c] border-2 border-gold flex items-center justify-center shadow-lg shadow-gold/30">
                <Crown className="w-7 h-7 text-gold animate-crown-glow" />
              </div>
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl sm:text-2xl font-bold font-serif text-foreground uppercase tracking-widest">
                Awaiting Scores
              </h2>
              <div className="flex items-center justify-center gap-4 text-gold/80 text-sm tracking-widest uppercase font-mono">
                <span className="hover:scale-125 transition-transform text-neutral-300">♠</span>
                <span className="text-casino-red hover:scale-125 transition-transform">♥</span>
                <span className="text-emerald hover:scale-125 transition-transform">♦</span>
                <span className="text-[#00e5ff] hover:scale-125 transition-transform">♣</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4 animate-podium-in w-full">
            {/* TOP 3 PODIUM PRESENTATION WITH PROMINENT VISUAL HIERARCHY */}
            <div className="grid grid-cols-3 gap-2.5 sm:gap-6 items-end max-w-4xl mx-auto w-full pt-1">
              <PodiumCard
                variant="silver"
                team={top2}
                currentScore={top2 ? (teamScores[top2.team_id] ?? top2.total_score) : 0}
                scoreDelta={top2 ? (scoreDeltas[top2.team_id] ?? null) : null}
                isSpinning={top2 ? (isSlotSpinning && affectedTeamIds.includes(top2.team_id)) : false}
                isShuffling={top2 ? (isNameplateShuffling && shufflingTeamIds.includes(top2.team_id)) : false}
                shiftInfo={top2 ? rankShifts[top2.team_id] : undefined}
                staggerDelay={1000}
                onReelSettled={handleReelSettled}
              />

              <PodiumCard
                variant="champion"
                team={top1}
                currentScore={top1 ? (teamScores[top1.team_id] ?? top1.total_score) : 0}
                scoreDelta={top1 ? (scoreDeltas[top1.team_id] ?? null) : null}
                isSpinning={top1 ? (isSlotSpinning && affectedTeamIds.includes(top1.team_id)) : false}
                isShuffling={top1 ? (isNameplateShuffling && shufflingTeamIds.includes(top1.team_id)) : false}
                shiftInfo={top1 ? rankShifts[top1.team_id] : undefined}
                crownCelebration={crownCelebration}
                staggerDelay={900}
                onReelSettled={handleReelSettled}
              />

              <PodiumCard
                variant="bronze"
                team={top3}
                currentScore={top3 ? (teamScores[top3.team_id] ?? top3.total_score) : 0}
                scoreDelta={top3 ? (scoreDeltas[top3.team_id] ?? null) : null}
                isSpinning={top3 ? (isSlotSpinning && affectedTeamIds.includes(top3.team_id)) : false}
                isShuffling={top3 ? (isNameplateShuffling && shufflingTeamIds.includes(top3.team_id)) : false}
                shiftInfo={top3 ? rankShifts[top3.team_id] : undefined}
                staggerDelay={1100}
                onReelSettled={handleReelSettled}
              />
            </div>

            {/* REMAINING TEAMS: DYNAMICALLY ALIGNED CHAMPIONSHIP STANDINGS PANEL (#4 ONWARDS) */}
            {restIds.length > 0 && (
              <div className="rounded-2xl border border-gold/30 bg-[#0c0810]/92 backdrop-blur-xl p-3 sm:p-4.5 max-w-6xl mx-auto w-full shadow-[0_12px_35px_rgba(0,0,0,0.85)] transition-all">
                <div className={getRestContainerClass(restIds.length)}>
                  {restIds.map((teamId, idx) => {
                    const team = teamsCatalog[teamId];
                    if (!team) return null;
                    const shift = rankShifts[team.team_id];
                    const isTeamSpinning = isSlotSpinning && affectedTeamIds.includes(team.team_id);
                    const teamDelta = scoreDeltas[team.team_id] ?? null;
                    const currentScore = teamScores[team.team_id] ?? team.total_score;

                    return (
                      <LeaderboardRow
                        key={team.team_id}
                        team={team}
                        rank={idx + 4}
                        currentScore={currentScore}
                        scoreDelta={teamDelta}
                        isSpinning={isTeamSpinning}
                        isShuffling={isNameplateShuffling && shufflingTeamIds.includes(team.team_id)}
                        shiftInfo={shift}
                        staggerDelay={1000 + Math.min(idx * 120, 360)}
                        itemClass={getRestItemClass(idx, restIds.length)}
                        onReelSettled={handleReelSettled}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
