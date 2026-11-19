"use client";

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import Image from "next/image";
import {
  Crown,
  Trophy,
  Medal,
  Maximize,
  Minimize,
  TrendingUp,
  TrendingDown,
  Volume2,
  VolumeX,
  FastForward,
  Sparkles,
} from "lucide-react";
import { cn } from "cn";
import { createClient } from "@/lib/supabase/client";
import type { Event, EventSettings, Round, LeaderboardEntry, Team } from "@/lib/types";
import { CasinoBackground } from "./casino-background";
import { SlotScoreReel } from "./slot-score-reel";
import { TeamNameplate } from "./team-nameplate";
import { BrandReveal } from "./brand-reveal";
import { casinoSound } from "./casino-sound";

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
// STATE 1: SCORE_ROLLING       - Scores spin in-place; leaderboard visual ordering frozen
// STATE 2: DIGITS_SETTLING     - Waiting for every affected reel to lock completely
// STATE 3: DIGITS_SETTLED      - All digits settled; check if ranking changed
// STATE 4: NAMEPLATE_SHUFFLING - Physical rectangular nameplates & scores slide between rank slots
// STATE 5: SETTLED             - Slide finished; rank badges revealed; celebration if leader changed
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
    // 4 total teams: One lower-ranked team, centred horizontally
    return "flex justify-center w-full";
  }
  if (count >= 2 && count <= 5) {
    // 5 total teams (count 2): one left, one right
    // 6 total teams (count 3): two on first row, third centred on second row
    // 7 total teams (count 4): 2 rows of 2
    // 8 total teams (count 5): 2 rows of 2 + 1 centred on third row
    return "grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3.5 max-w-4xl mx-auto w-full";
  }
  // Larger numbers: balanced 3-column responsive grid with scrollbar
  return "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-2.5 max-h-48 sm:max-h-60 lg:max-h-68 overflow-y-auto admin-scroll pr-1.5 w-full";
}

function getRestItemClass(index: number, count: number): string {
  if (count === 1) {
    return "w-full max-w-md sm:max-w-lg";
  }
  if (count === 3 && index === 2) {
    // 6 total teams: third team centred on second row
    return "sm:col-span-2 sm:max-w-md sm:mx-auto w-full";
  }
  if (count === 5 && index === 4) {
    // 8 total teams: 5th team centred on third row
    return "sm:col-span-2 sm:max-w-md sm:mx-auto w-full";
  }
  if (count > 5 && count % 3 === 1 && index === count - 1) {
    // Trailing item in 3-column layout centred across columns
    return "lg:col-span-3 lg:max-w-md lg:mx-auto w-full";
  }
  return "w-full";
}

export function LiveScoreboard({
  initialEvent,
  initialSettings,
  initialRound,
  initialLeaderboard,
  isPublicView = false,
  headingFontClassName,
}: LiveScoreboardProps) {
  const [event] = useState<Event | null>(initialEvent);
  const eventId = event?.id || initialEvent?.id || null;
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(initialLeaderboard);
  const [settings] = useState<EventSettings | null>(initialSettings);
  const [activeRound, setActiveRound] = useState<Round | null>(initialRound);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [crownCelebration, setCrownCelebration] = useState(false);
  const [rankShifts, setRankShifts] = useState<Record<string, RankShiftInfo>>({});
  const [isAudioMuted, setIsAudioMuted] = useState(true);

  // Brand Reveal Intro State
  const [showBrandIntro, setShowBrandIntro] = useState<boolean>(isPublicView);

  // 5-State Sequential Animation Machine
  const [animState, setAnimState] = useState<ScoreboardAnimState>("IDLE");
  const animStateRef = useRef<ScoreboardAnimState>("IDLE");

  const [isSlotSpinning, setIsSlotSpinning] = useState(false);
  const [isNameplateShuffling, setIsNameplateShuffling] = useState(false);
  const [affectedTeamIds, setAffectedTeamIds] = useState<string[]>([]);
  const [scoreDeltas, setScoreDeltas] = useState<Record<string, number>>({});

  const spinTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pauseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rankResetTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sequential animation tracking refs
  const pendingRankedRef = useRef<LeaderboardEntry[] | null>(null);
  const settledTeamsRef = useRef<Set<string>>(new Set());
  const firstNameplateRectsRef = useRef<Record<string, DOMRect> | null>(null);
  const firstScoreRectsRef = useRef<Record<string, DOMRect> | null>(null);
  const pendingShiftsRef = useRef<Record<string, RankShiftInfo> | null>(null);

  // Score and Rank tracking refs (Authoritative baseline)
  const prevLeaderId = useRef<string | null>(initialLeaderboard[0]?.team_id || null);
  const prevRanksRef = useRef<Record<string, number>>({});
  const prevScoresRef = useRef<Record<string, number>>({});
  const isInitialMountRef = useRef<boolean>(true);

  // Request sequencing and deduplication refs to prevent stale/out-of-order overwrite
  const latestRequestIdRef = useRef<number>(0);
  const latestProcessedTimestampRef = useRef<number>(0);

  // Synchronize state ref helper
  const updateAnimState = useCallback((state: ScoreboardAnimState) => {
    animStateRef.current = state;
    setAnimState(state);
  }, []);

  // Initialize previous scores & ranks on initial mount
  useEffect(() => {
    const scoreMap: Record<string, number> = {};
    const rankMap: Record<string, number> = {};
    initialLeaderboard.forEach((t) => {
      scoreMap[t.team_id] = t.total_score;
      rankMap[t.team_id] = t.rank;
    });
    prevScoresRef.current = scoreMap;
    prevRanksRef.current = rankMap;
  }, [initialLeaderboard]);

  // Handle immediate skip of the reveal sequence
  const handleSkipReveal = useCallback(() => {
    if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    if (rankResetTimerRef.current) clearTimeout(rankResetTimerRef.current);
    casinoSound.stopSlotRoll();

    // Reset any in-flight nameplate & score transforms
    const movingEls = document.querySelectorAll<HTMLElement>(
      "[data-team-nameplate], [data-team-score]"
    );
    movingEls.forEach((el) => {
      el.style.transform = "";
      el.style.transition = "";
      el.style.zIndex = "";
    });

    if (pendingRankedRef.current) {
      setLeaderboard(pendingRankedRef.current);
    }

    setShowBrandIntro(false);
    setIsSlotSpinning(false);
    setIsNameplateShuffling(false);
    updateAnimState("IDLE");
    setAffectedTeamIds([]);
    setScoreDeltas({});
  }, [updateAnimState]);

  // Brand reveal completion handler
  const handleBrandRevealComplete = useCallback(() => {
    setShowBrandIntro(false);
  }, []);

  // STATE 4: Launch physical rectangular nameplate and score shuffle
  const startNameplateShuffle = useCallback(
    (targetLeaderboard: LeaderboardEntry[], newShifts: Record<string, RankShiftInfo>) => {
      // 1. FIRST: Measure bounding rects of nameplates and scores before DOM reorder
      const nameplateRects: Record<string, DOMRect> = {};
      const scoreRects: Record<string, DOMRect> = {};

      document.querySelectorAll<HTMLElement>("[data-team-nameplate]").forEach((el) => {
        const id = el.getAttribute("data-team-nameplate");
        if (id) nameplateRects[id] = el.getBoundingClientRect();
      });

      document.querySelectorAll<HTMLElement>("[data-team-score]").forEach((el) => {
        const id = el.getAttribute("data-team-score");
        if (id) scoreRects[id] = el.getBoundingClientRect();
      });

      firstNameplateRectsRef.current = nameplateRects;
      firstScoreRectsRef.current = scoreRects;
      pendingShiftsRef.current = newShifts;

      setIsNameplateShuffling(true);
      updateAnimState("NAMEPLATE_SHUFFLING");

      // 2. LAST: Apply target ranking to React state (DOM will reorder into new slots)
      setLeaderboard(targetLeaderboard);
    },
    [updateAnimState]
  );

  // STATE 3: Invoked when ALL affected slot score reels have settled completely
  const handleAllReelsSettled = useCallback(() => {
    setIsSlotSpinning(false);
    casinoSound.stopSlotRoll();
    updateAnimState("DIGITS_SETTLED");

    const nextRanked = pendingRankedRef.current;
    if (!nextRanked) {
      updateAnimState("IDLE");
      return;
    }

    // Compare current displayed visual order vs target ranked order
    let rankOrderChanged = false;
    const newShifts: Record<string, RankShiftInfo> = {};

    leaderboard.forEach((team, oldIdx) => {
      const newIdx = nextRanked.findIndex((t) => t.team_id === team.team_id);
      const oldRank = oldIdx + 1;
      const newRank = newIdx >= 0 ? newIdx + 1 : oldRank;
      if (oldRank !== newRank) {
        rankOrderChanged = true;
        newShifts[team.team_id] = {
          from: oldRank,
          to: newRank,
          direction: newRank < oldRank ? "up" : "down",
        };
      }
    });

    if (!rankOrderChanged) {
      // Score updated, but ranking order unchanged: keep teams in place without shuffle!
      setLeaderboard(nextRanked);
      updateAnimState("SETTLED");
      if (rankResetTimerRef.current) clearTimeout(rankResetTimerRef.current);
      rankResetTimerRef.current = setTimeout(() => {
        setAffectedTeamIds([]);
        setScoreDeltas({});
        updateAnimState("IDLE");
      }, 3500);
      return;
    }

    // Rank order CHANGED! Give 250ms satisfying pause with locked scores before shuffle starts
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      startNameplateShuffle(nextRanked, newShifts);
    }, 250);
  }, [leaderboard, updateAnimState, startNameplateShuffle]);

  // STATE 2: Settled detection callback from individual score reels
  const handleReelSettled = useCallback(
    (teamId: string) => {
      settledTeamsRef.current.add(teamId);
      if (
        affectedTeamIds.length > 0 &&
        affectedTeamIds.every((id) => settledTeamsRef.current.has(id))
      ) {
        if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
        handleAllReelsSettled();
      }
    },
    [affectedTeamIds, handleAllReelsSettled]
  );

  // STATE 4 FLIP: Invert and Play layout animation for physical rectangular nameplate & score shuffle
  useLayoutEffect(() => {
    if (animState !== "NAMEPLATE_SHUFFLING" || !firstNameplateRectsRef.current) return;

    const firstPlates = firstNameplateRectsRef.current;
    const firstScores = firstScoreRectsRef.current || {};
    firstNameplateRectsRef.current = null;
    firstScoreRectsRef.current = null;

    const movingPlates: { el: HTMLElement; dx: number; dy: number; isUp: boolean }[] = [];
    const movingScores: { el: HTMLElement; dx: number; dy: number; isUp: boolean }[] = [];

    // FLIP Nameplates
    document.querySelectorAll<HTMLElement>("[data-team-nameplate]").forEach((el) => {
      const id = el.getAttribute("data-team-nameplate");
      if (!id || !firstPlates[id]) return;

      const first = firstPlates[id];
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        const shift = pendingShiftsRef.current?.[id];
        const isUp = shift?.direction === "up";

        // Invert: hold element at previous visual position
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.style.transition = "none";
        el.style.zIndex = isUp ? "60" : "45";

        movingPlates.push({ el, dx, dy, isUp });
      }
    });

    // FLIP Corresponding Score Displays
    document.querySelectorAll<HTMLElement>("[data-team-score]").forEach((el) => {
      const id = el.getAttribute("data-team-score");
      if (!id || !firstScores[id]) return;

      const first = firstScores[id];
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        const shift = pendingShiftsRef.current?.[id];
        const isUp = shift?.direction === "up";

        // Invert: hold score at previous visual position
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.style.transition = "none";
        el.style.zIndex = isUp ? "60" : "45";

        movingScores.push({ el, dx, dy, isUp });
      }
    });

    if (movingPlates.length === 0 && movingScores.length === 0) {
      setIsNameplateShuffling(false);
      updateAnimState("SETTLED");
      return;
    }

    // PLAY: Animate to final positions in next animation frame
    const animFrame = requestAnimationFrame(() => {
      casinoSound.playNameplateShuffle();
      casinoSound.playScoreReveal(true);

      movingPlates.forEach(({ el }) => {
        el.style.transition = "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "translate(0px, 0px)";
      });

      movingScores.forEach(({ el }) => {
        el.style.transition = "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "translate(0px, 0px)";
      });
    });

    const slideDurationMs = 680;
    const timeout = setTimeout(() => {
      // Settle complete: clean up inline transform and z-index styles
      movingPlates.forEach(({ el }) => {
        el.style.transform = "";
        el.style.transition = "";
        el.style.zIndex = "";
      });
      movingScores.forEach(({ el }) => {
        el.style.transform = "";
        el.style.transition = "";
        el.style.zIndex = "";
      });

      setIsNameplateShuffling(false);
      updateAnimState("SETTLED");

      // STATE 5: Reveal Rank Indicators after nameplates have settled
      if (pendingShiftsRef.current) {
        setRankShifts(pendingShiftsRef.current);
        pendingShiftsRef.current = null;
      }

      // Check if champion changed
      const currentTopId = leaderboard[0]?.team_id;
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
  }, [animState, leaderboard, updateAnimState]);

  // Fetch latest leaderboard and round directly from Supabase view (authoritative source of truth)
  const refreshLeaderboard = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    try {
      const supabase = createClient();

      // 1. Fetch active round (scoped to eventId)
      let rndQuery = supabase
        .from("rounds")
        .select("*")
        .eq("status", "active")
        .is("deleted_at", null);
      if (eventId) {
        rndQuery = rndQuery.eq("event_id", eventId);
      }
      const { data: rndData } = await rndQuery
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (requestId !== latestRequestIdRef.current) return;

      if (rndData) {
        setActiveRound(rndData as Round);
      }

      // 2. Fetch authoritative overall leaderboard from view (scoped to eventId)
      let lbQuery = supabase
        .from("v_public_overall_leaderboard")
        .select("*");
      if (eventId) {
        lbQuery = lbQuery.eq("event_id", eventId);
      }
      const { data: viewData, error } = await lbQuery.order("rank", { ascending: true });

      if (requestId !== latestRequestIdRef.current) return;

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
          const startingScore = Number(settings?.starting_score || 0.0);
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

      // On initial load or page refresh, establish baseline without replaying stale animations
      if (isInitialMountRef.current) {
        isInitialMountRef.current = false;
        nextLeaderboard.forEach((t) => {
          prevScoresRef.current[t.team_id] = t.total_score;
          prevRanksRef.current[t.team_id] = t.rank;
        });
        prevLeaderId.current = nextLeaderboard[0]?.team_id || null;
        setLeaderboard(nextLeaderboard);
        return;
      }

      // CRITICAL GUARD: If an animation is actively rolling or shuffling,
      // do NOT mutate displayed leaderboard or disrupt the in-flight FLIP animation!
      if (animStateRef.current !== "IDLE" && animStateRef.current !== "SETTLED") {
        pendingRankedRef.current = nextLeaderboard;
        return;
      }

      // Check which teams received actual score changes (detect deltas purely for animations)
      const affected: string[] = [];
      const deltas: Record<string, number> = {};

      nextLeaderboard.forEach((team) => {
        const oldScore = prevScoresRef.current[team.team_id];
        if (oldScore !== undefined && oldScore !== team.total_score) {
          affected.push(team.team_id);
          // Delta is the actual change from previous displayed score to authoritative new score.
          deltas[team.team_id] = team.total_score - oldScore;
        }
        prevScoresRef.current[team.team_id] = team.total_score;
      });

      if (affected.length > 0) {
        // Target authoritative ranking
        const sorted = [...nextLeaderboard].sort((a, b) => b.total_score - a.total_score);
        const ranked = sorted.map((t, idx) => ({ ...t, rank: idx + 1 }));
        pendingRankedRef.current = ranked;

        // Keep teams in current visual slots, update total_score in-place so reels spin in current slots
        setLeaderboard((prev) => {
          const scoreMap: Record<string, number> = {};
          nextLeaderboard.forEach((t) => {
            scoreMap[t.team_id] = t.total_score;
          });
          return prev.map((t) => ({
            ...t,
            total_score: scoreMap[t.team_id] ?? t.total_score,
          }));
        });

        settledTeamsRef.current.clear();
        setAffectedTeamIds(affected);
        setScoreDeltas(deltas);
        setIsSlotSpinning(true);
        updateAnimState("SCORE_ROLLING");
        casinoSound.startSlotRoll(1600);

        if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
        spinTimerRef.current = setTimeout(() => {
          handleAllReelsSettled();
        }, 3500);
      } else {
        // No score changes (e.g. metadata/settings update)
        setLeaderboard(nextLeaderboard);
      }
    } catch {
      // Handled gracefully
    }
  }, [eventId, settings, updateAnimState, handleAllReelsSettled]);

  // Apply authoritative scores directly from real-time broadcast payload (resulting_score)
  // This guarantees zero score drift, instant updates, and full idempotency
  const applyDirectAuthoritativeScores = useCallback(
    (scores: Record<string, number>) => {
      setLeaderboard((prevLeaderboard) => {
        const affected: string[] = [];
        const deltas: Record<string, number> = {};

        // Keep existing visual slot order, update total_score in-place so reels spin in current slots
        const inPlace = prevLeaderboard.map((team) => {
          if (scores[team.team_id] !== undefined) {
            const newScore = scores[team.team_id];
            const oldScore = prevScoresRef.current[team.team_id] ?? team.total_score;
            if (newScore !== oldScore) {
              affected.push(team.team_id);
              // Delta is purely for visual animation badges, calculated from old score to new authoritative resulting score
              deltas[team.team_id] = newScore - oldScore;
              prevScoresRef.current[team.team_id] = newScore;
            }
            return { ...team, total_score: newScore };
          }
          return team;
        });

        if (affected.length === 0) {
          return prevLeaderboard; // Idempotent: duplicate notification ignored
        }

        // Compute authoritative target ranking
        const sorted = [...inPlace].sort((a, b) => b.total_score - a.total_score);
        const ranked = sorted.map((t, idx) => ({ ...t, rank: idx + 1 }));
        pendingRankedRef.current = ranked;

        // Start score roll phase in current visual positions (STATE 1)
        settledTeamsRef.current.clear();
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

        return inPlace;
      });
    },
    [updateAnimState, handleAllReelsSettled]
  );

  // Realtime subscription to teams, rounds, event_settings and broadcast score updates
  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      const channelName = eventId ? `scoreboard:${eventId}` : "public-scoreboard-realtime";

      channel = supabase
        .channel(channelName)
        .on("broadcast", { event: "score_update" }, (message) => {
          const payload = message?.payload;
          if (payload?.eventId && eventId && payload.eventId !== eventId) {
            return; // Not for this event
          }
          if (payload?.timestamp && payload.timestamp < latestProcessedTimestampRef.current) {
            // Discard older out-of-order broadcast
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
            applyDirectAuthoritativeScores(directScores);
          } else {
            // Fallback for non-score broadcast updates
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
        .subscribe();
    } catch {
      // Realtime subscription setup fallback
    }

    const interval = setInterval(refreshLeaderboard, 5000);

    return () => {
      if (channel) {
        const supabase = createClient();
        supabase.removeChannel(channel);
      }
      clearInterval(interval);
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (rankResetTimerRef.current) clearTimeout(rankResetTimerRef.current);
      casinoSound.stopSlotRoll();
    };
  }, [eventId, refreshLeaderboard, applyDirectAuthoritativeScores]);

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

  const top1 = leaderboard[0] || null;
  const top2 = leaderboard[1] || null;
  const top3 = leaderboard[2] || null;
  const rest = leaderboard.slice(3);

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
          {/* Smooth Round Indicator Pill */}
          <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-[#120a10]/85 border border-gold/35 text-xs sm:text-sm tracking-widest text-gold uppercase font-bold backdrop-blur-md shadow-md transition-all duration-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              {activeRound
                ? `Round ${activeRound.round_number}: ${activeRound.name}`
                : "Round 1: Main Event"}
            </span>
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
        {leaderboard.length === 0 ? (
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
              {/* RANK 2: SILVER / CHROME PODIUM */}
              <div className="flex flex-col items-center transition-all duration-700 ease-out">
                {top2 ? (
                  <div className="w-full rounded-2xl border-2 border-slate-300/70 bg-gradient-to-b from-[#181d26]/95 via-[#0e1218]/95 to-[#06080c]/98 backdrop-blur-xl p-3 sm:p-5 text-center space-y-2 shadow-[0_10px_30px_rgba(0,0,0,0.7)] hover:border-slate-200 transition-all duration-500 relative">
                    {/* Metallic Shimmer Sweep in inner clipped container */}
                    <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                      <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-white/8 to-transparent animate-shimmer-sweep" />
                    </div>

                    {/* Rank Shift Indicator */}
                    {rankShifts[top2.team_id] && (
                      <div className="absolute top-2 right-2 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald/20 text-emerald-300 border border-emerald/50 animate-bounce z-20">
                        {rankShifts[top2.team_id].direction === "up" ? (
                          <TrendingUp className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <TrendingDown className="w-3 h-3 text-casino-red" />
                        )}
                        <span>
                          {rankShifts[top2.team_id].direction === "up"
                            ? `▲ ${rankShifts[top2.team_id].from - rankShifts[top2.team_id].to}`
                            : `▼ ${rankShifts[top2.team_id].to - rankShifts[top2.team_id].from}`}
                        </span>
                      </div>
                    )}

                    {/* Stationary Trophy & Rank Badge */}
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-300/20 border border-slate-300/60 text-slate-100 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(148,163,184,0.35)]">
                      <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-slate-100" />
                    </div>

                    <span className="text-[10px] sm:text-xs font-bold text-slate-300 uppercase tracking-widest block font-mono">
                      Rank 2 • Silver
                    </span>

                    {/* Moving Team Identity: Rectangular Nameplate & Settled Score Reel */}
                    <div
                      data-team-identity={top2.team_id}
                      className="space-y-2 flex flex-col items-center w-full relative"
                    >
                      <TeamNameplate
                        teamId={top2.team_id}
                        teamName={top2.team_name}
                        teamColor={top2.team_color}
                        variant="silver"
                        isShuffling={isNameplateShuffling}
                        className="w-full max-w-[210px] sm:max-w-[250px]"
                      />

                      {/* Mechanical Slot Machine Number Reel for Rank 2 */}
                      <div
                        data-team-score={top2.team_id}
                        className="pt-2 border-t border-slate-400/25 flex justify-center w-full will-change-transform"
                      >
                        <SlotScoreReel
                          value={top2.total_score}
                          delta={scoreDeltas[top2.team_id] ?? null}
                          isSpinning={isSlotSpinning && affectedTeamIds.includes(top2.team_id)}
                          staggerDelay={1000}
                          variant="silver"
                          onSettled={() => handleReelSettled(top2.team_id)}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-32 rounded-2xl border border-dashed border-border/40 flex items-center justify-center text-xs text-muted-foreground uppercase">
                    Rank 2
                  </div>
                )}
                {/* Silver Pedestal Base */}
                <div className="hidden sm:block w-4/5 h-4 bg-gradient-to-r from-slate-400/20 via-slate-300/40 to-slate-400/20 border-x border-b border-slate-300/50 rounded-b-xl shadow-md" />
              </div>

              {/* RANK 1: DOMINANT ROYAL GOLD CHAMPION PODIUM (CENTER & ELEVATED) */}
              <div className="flex flex-col items-center -translate-y-3 sm:-translate-y-7 transition-all duration-700 ease-out z-10 relative">
                {/* Golden Spotlight from above illuminating Rank 1 */}
                <div className="absolute -top-36 left-1/2 -translate-x-1/2 w-72 sm:w-88 h-[400px] bg-gradient-to-b from-amber-200/25 via-gold/15 to-transparent blur-2xl pointer-events-none animate-champion-spotlight -z-10" />

                {top1 ? (
                  <div
                    className={cn(
                      "w-full rounded-3xl border-2 border-[#f0c85a] bg-gradient-to-b from-[#281a08]/98 via-[#150d05]/98 to-[#060404]/98 backdrop-blur-xl p-4 sm:p-6 text-center space-y-2.5 transition-all duration-700 relative",
                      crownCelebration
                        ? "ring-4 ring-gold shadow-[0_0_80px_rgba(240,200,90,0.85)] scale-105"
                        : "shadow-[0_0_55px_rgba(212,168,67,0.45)]"
                    )}
                  >
                    {/* Golden Shimmer Sweep in inner clipped container */}
                    <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none">
                      <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-gold/12 to-transparent animate-shimmer-sweep" />
                    </div>

                    {/* Rank Shift Indicator */}
                    {rankShifts[top1.team_id] && (
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-gold/30 text-gold-bright border border-gold shadow-lg animate-bounce z-20">
                        <TrendingUp className="w-3.5 h-3.5 text-gold-bright" />
                        <span>NEW LEADER</span>
                      </div>
                    )}

                    {/* Stationary Gold Crown Badge with Aura */}
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-b from-gold/40 to-gold/10 border-2 border-[#f0c85a] text-gold flex items-center justify-center mx-auto shadow-[0_0_28px_rgba(240,200,90,0.6)]">
                      <Crown
                        className={cn(
                          "w-6 h-6 sm:w-9 sm:h-9 text-gold-bright",
                          crownCelebration ? "animate-bounce" : "animate-crown-glow"
                        )}
                      />
                    </div>

                    <span className="text-[11px] sm:text-xs font-black text-gold uppercase tracking-widest block font-mono">
                      Rank 1 • Champion
                    </span>

                    {/* Moving Team Identity: Rectangular Nameplate & Settled Score Reel */}
                    <div
                      data-team-identity={top1.team_id}
                      className="space-y-2.5 flex flex-col items-center w-full relative"
                    >
                      <TeamNameplate
                        teamId={top1.team_id}
                        teamName={top1.team_name}
                        teamColor={top1.team_color}
                        variant="champion"
                        isShuffling={isNameplateShuffling}
                        className="w-full max-w-[220px] sm:max-w-[270px]"
                      />

                      {/* Mechanical Slot Machine Number Reel for Rank 1 */}
                      <div
                        data-team-score={top1.team_id}
                        className="pt-2.5 border-t border-gold/45 flex justify-center w-full will-change-transform"
                      >
                        <SlotScoreReel
                          value={top1.total_score}
                          delta={scoreDeltas[top1.team_id] ?? null}
                          isSpinning={isSlotSpinning && affectedTeamIds.includes(top1.team_id)}
                          staggerDelay={900}
                          variant="champion"
                          onSettled={() => handleReelSettled(top1.team_id)}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-40 rounded-3xl border border-dashed border-gold/40 flex items-center justify-center text-xs text-gold uppercase">
                    Rank 1
                  </div>
                )}
                {/* Royal Gold Pedestal Base */}
                <div className="hidden sm:block w-5/6 h-6 bg-gradient-to-r from-gold/30 via-gold/60 to-gold/30 border-x border-b border-gold/70 rounded-b-2xl shadow-[0_8px_25px_rgba(212,168,67,0.4)] animate-pedestal-gold" />
              </div>

              {/* RANK 3: CASINO RED & BRONZE PODIUM */}
              <div className="flex flex-col items-center transition-all duration-700 ease-out">
                {top3 ? (
                  <div className="w-full rounded-2xl border-2 border-casino-red/70 bg-gradient-to-b from-[#280c10]/95 via-[#150608]/95 to-[#080204]/98 backdrop-blur-xl p-3 sm:p-5 text-center space-y-2 shadow-[0_10px_30px_rgba(0,0,0,0.7)] hover:border-casino-red transition-all duration-500 relative">
                    {/* Metallic Shimmer Sweep in inner clipped container */}
                    <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                      <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-amber-400/8 to-transparent animate-shimmer-sweep" />
                    </div>

                    {/* Rank Shift Indicator */}
                    {rankShifts[top3.team_id] && (
                      <div className="absolute top-2 right-2 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/50 animate-bounce z-20">
                        {rankShifts[top3.team_id].direction === "up" ? (
                          <TrendingUp className="w-3 h-3 text-amber-400" />
                        ) : (
                          <TrendingDown className="w-3 h-3 text-casino-red" />
                        )}
                        <span>
                          {rankShifts[top3.team_id].direction === "up"
                            ? `▲ ${rankShifts[top3.team_id].from - rankShifts[top3.team_id].to}`
                            : `▼ ${rankShifts[top3.team_id].to - rankShifts[top3.team_id].from}`}
                        </span>
                      </div>
                    )}

                    {/* Stationary Medal & Rank Badge */}
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-casino-red/25 border border-casino-red/60 text-[#ffb399] flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(192,57,43,0.4)]">
                      <Medal className="w-5 h-5 sm:w-6 sm:h-6 text-[#ffb399]" />
                    </div>

                    <span className="text-[10px] sm:text-xs font-bold text-red-300 uppercase tracking-widest block font-mono">
                      Rank 3 • Bronze
                    </span>

                    {/* Moving Team Identity: Rectangular Nameplate & Settled Score Reel */}
                    <div
                      data-team-identity={top3.team_id}
                      className="space-y-2 flex flex-col items-center w-full relative"
                    >
                      <TeamNameplate
                        teamId={top3.team_id}
                        teamName={top3.team_name}
                        teamColor={top3.team_color}
                        variant="bronze"
                        isShuffling={isNameplateShuffling}
                        className="w-full max-w-[210px] sm:max-w-[250px]"
                      />

                      {/* Mechanical Slot Machine Number Reel for Rank 3 */}
                      <div
                        data-team-score={top3.team_id}
                        className="pt-2 border-t border-casino-red/35 flex justify-center w-full will-change-transform"
                      >
                        <SlotScoreReel
                          value={top3.total_score}
                          delta={scoreDeltas[top3.team_id] ?? null}
                          isSpinning={isSlotSpinning && affectedTeamIds.includes(top3.team_id)}
                          staggerDelay={1100}
                          variant="bronze"
                          onSettled={() => handleReelSettled(top3.team_id)}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-32 rounded-2xl border border-dashed border-border/40 flex items-center justify-center text-xs text-muted-foreground uppercase">
                    Rank 3
                  </div>
                )}
                {/* Bronze / Red Pedestal Base */}
                <div className="hidden sm:block w-4/5 h-4 bg-gradient-to-r from-casino-red/30 via-amber-600/40 to-casino-red/30 border-x border-b border-casino-red/50 rounded-b-xl shadow-md" />
              </div>
            </div>

            {/* REMAINING TEAMS: DYNAMICALLY ALIGNED CHAMPIONSHIP STANDINGS PANEL (#4 ONWARDS) */}
            {rest.length > 0 && (
              <div className="rounded-2xl border border-gold/30 bg-[#0c0810]/92 backdrop-blur-xl p-3 sm:p-4.5 max-w-6xl mx-auto w-full shadow-[0_12px_35px_rgba(0,0,0,0.85)] transition-all">
                <div className={getRestContainerClass(rest.length)}>
                  {rest.map((team, idx) => {
                    const shift = rankShifts[team.team_id];
                    const isTeamSpinning = isSlotSpinning && affectedTeamIds.includes(team.team_id);
                    const teamDelta = scoreDeltas[team.team_id] ?? null;

                    return (
                      <div
                        key={team.team_id}
                        className={cn(
                          "h-14 sm:h-16 flex items-center justify-between px-3.5 sm:px-4 rounded-xl border border-white/10 bg-[#130b14]/85 hover:border-gold/50 hover:bg-[#1c0f1c]/90 transition-all duration-300 shadow-sm relative",
                          shift && "border-gold/60 bg-gold/10",
                          getRestItemClass(idx, rest.length)
                        )}
                      >
                        {/* Fixed Stationary Rank Badge & Shift Indicator */}
                        <div className="flex items-center gap-2.5 shrink-0 z-10">
                          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/85 border border-gold/40 text-xs sm:text-sm font-mono font-bold text-gold-bright shrink-0 shadow-sm">
                            #{team.rank}
                          </span>

                          {shift && (
                            <span
                              className={cn(
                                "flex items-center gap-0.5 text-[10px] sm:text-xs font-bold shrink-0 animate-bounce",
                                shift.direction === "up" ? "text-emerald-400" : "text-casino-red"
                              )}
                            >
                              {shift.direction === "up" ? (
                                <TrendingUp className="w-3.5 h-3.5" />
                              ) : (
                                <TrendingDown className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {shift.direction === "up" ? `+${shift.from - shift.to}` : `-${shift.to - shift.from}`}
                              </span>
                            </span>
                          )}
                        </div>

                        {/* Moving Team Identity: Rectangular Nameplate & Settled Score Reel */}
                        <div
                          data-team-identity={team.team_id}
                          className="flex items-center justify-between flex-1 min-w-0 pl-3 relative"
                        >
                          <TeamNameplate
                            teamId={team.team_id}
                            teamName={team.team_name}
                            teamColor={team.team_color}
                            variant="standard"
                            isShuffling={isNameplateShuffling}
                            className="max-w-[210px] sm:max-w-[250px]"
                          />

                          <div
                            data-team-score={team.team_id}
                            className="text-right shrink-0 will-change-transform"
                          >
                            <SlotScoreReel
                              value={team.total_score}
                              delta={teamDelta}
                              isSpinning={isTeamSpinning}
                              staggerDelay={1000 + Math.min(idx * 120, 360)}
                              variant="standard"
                              onSettled={() => handleReelSettled(team.team_id)}
                            />
                          </div>
                        </div>
                      </div>
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
