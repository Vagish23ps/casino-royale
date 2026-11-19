"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
} from "lucide-react";
import { cn } from "cn";
import { createClient } from "@/lib/supabase/client";
import type { Event, EventSettings, Round, LeaderboardEntry, Team } from "@/lib/types";
import { CasinoBackground } from "./casino-background";
import { SlotScoreReel } from "./slot-score-reel";
import { CurtainReveal } from "./roulette-reveal";
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

  // Score Reveal State (Curtains -> Mechanical Slot Machine Reels)
  const [showCurtainIntro, setShowCurtainIntro] = useState(false);
  const [isSlotSpinning, setIsSlotSpinning] = useState(false);
  const [affectedTeamIds, setAffectedTeamIds] = useState<string[]>([]);
  const [scoreDeltas, setScoreDeltas] = useState<Record<string, number>>({});
  const [updatedTeamsCount, setUpdatedTeamsCount] = useState(0);

  const spinTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Score and Rank tracking refs (Authoritative baseline)
  const prevLeaderId = useRef<string | null>(initialLeaderboard[0]?.team_id || null);
  const prevRanksRef = useRef<Record<string, number>>({});
  const prevScoresRef = useRef<Record<string, number>>({});
  const isInitialMountRef = useRef<boolean>(true);

  // Request sequencing and deduplication refs to prevent stale/out-of-order overwrite
  const latestRequestIdRef = useRef<number>(0);
  const latestProcessedTimestampRef = useRef<number>(0);

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
    setShowCurtainIntro(false);
    setIsSlotSpinning(false);
    setAffectedTeamIds([]);
    setScoreDeltas({});
  }, []);

  // When the Cinematic Curtain introduction finishes, transition directly to slot-machine reel spin on scoreboard
  const handleCurtainComplete = useCallback(() => {
    setShowCurtainIntro(false);
    setIsSlotSpinning(true);

    // Audio cue for slot reel spinning
    casinoSound.playSlotReelClick(1.2);

    // Schedule settling of all reels
    if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    spinTimerRef.current = setTimeout(() => {
      setIsSlotSpinning(false);

      // Clear deltas and affected markers after celebration window
      setTimeout(() => {
        setAffectedTeamIds([]);
        setScoreDeltas({});
      }, 5000);
    }, 3600);
  }, []);

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

      // Check which teams received actual score changes (detect deltas purely for animations)
      const affected: string[] = [];
      const deltas: Record<string, number> = {};

      nextLeaderboard.forEach((team) => {
        const oldScore = prevScoresRef.current[team.team_id];
        if (oldScore !== undefined && oldScore !== team.total_score) {
          affected.push(team.team_id);
          // Delta is the actual change from previous displayed score to authoritative new score.
          // For SET_SCORE, this reflects (resulting_score - oldScore), never an additive accumulation.
          deltas[team.team_id] = team.total_score - oldScore;
        }
      });

      // Compute rank shifts
      const newShifts: Record<string, RankShiftInfo> = {};
      let hasShifts = false;

      nextLeaderboard.forEach((t) => {
        const oldRank = prevRanksRef.current[t.team_id];
        if (oldRank !== undefined && oldRank !== t.rank) {
          hasShifts = true;
          newShifts[t.team_id] = {
            from: oldRank,
            to: t.rank,
            direction: t.rank < oldRank ? "up" : "down",
          };
        }
        // Authoritatively update tracking baseline with the exact new values
        prevRanksRef.current[t.team_id] = t.rank;
        prevScoresRef.current[t.team_id] = t.total_score;
      });

      if (hasShifts) {
        setRankShifts(newShifts);
        setTimeout(() => setRankShifts({}), 6500);
      }

      // Check if 1st place champion has changed
      const currentTopId = nextLeaderboard[0]?.team_id;
      if (currentTopId && prevLeaderId.current && currentTopId !== prevLeaderId.current) {
        setCrownCelebration(true);
        casinoSound.playChampionFanfare();
        setTimeout(() => setCrownCelebration(false), 5500);
      }
      prevLeaderId.current = currentTopId || null;

      if (affected.length > 0) {
        // Coordinated animation reveal sequence:
        // Update authoritative leaderboard state immediately so SlotScoreReel spins directly
        // to the NEW target digits!
        setLeaderboard(nextLeaderboard);
        setAffectedTeamIds(affected);
        setScoreDeltas(deltas);
        setUpdatedTeamsCount(affected.length);
        setShowCurtainIntro(true);
      } else {
        // No score changes (e.g. metadata/settings update)
        setLeaderboard(nextLeaderboard);
      }
    } catch {
      // Handled gracefully
    }
  }, [eventId, settings]);

  // Apply authoritative scores directly from real-time broadcast payload (resulting_score)
  // This guarantees zero score drift, instant updates, and full idempotency
  const applyDirectAuthoritativeScores = useCallback((scores: Record<string, number>) => {
    setLeaderboard((prevLeaderboard) => {
      const affected: string[] = [];
      const deltas: Record<string, number> = {};

      const updated = prevLeaderboard.map((team) => {
        if (scores[team.team_id] !== undefined) {
          const newScore = scores[team.team_id];
          const oldScore = prevScoresRef.current[team.team_id] ?? team.total_score;
          if (newScore !== oldScore) {
            affected.push(team.team_id);
            // Delta is purely for visual animation badges, calculated from old score to new authoritative resulting score
            // For SET_SCORE, this reflects (resulting_score - oldScore), never an additive accumulation.
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

      // Re-sort and re-rank authoritatively
      const sorted = [...updated].sort((a, b) => b.total_score - a.total_score);
      const ranked = sorted.map((t, idx) => ({ ...t, rank: idx + 1 }));

      // Compute rank shifts
      const newShifts: Record<string, RankShiftInfo> = {};
      let hasShifts = false;
      ranked.forEach((t) => {
        const oldRank = prevRanksRef.current[t.team_id];
        if (oldRank !== undefined && oldRank !== t.rank) {
          hasShifts = true;
          newShifts[t.team_id] = {
            from: oldRank,
            to: t.rank,
            direction: t.rank < oldRank ? "up" : "down",
          };
        }
        prevRanksRef.current[t.team_id] = t.rank;
      });

      if (hasShifts) {
        setRankShifts(newShifts);
        setTimeout(() => setRankShifts({}), 6500);
      }

      // Check if 1st place champion has changed
      const currentTopId = ranked[0]?.team_id;
      if (currentTopId && prevLeaderId.current && currentTopId !== prevLeaderId.current) {
        setCrownCelebration(true);
        casinoSound.playChampionFanfare();
        setTimeout(() => setCrownCelebration(false), 5500);
      }
      prevLeaderId.current = currentTopId || null;

      setAffectedTeamIds(affected);
      setScoreDeltas(deltas);
      setUpdatedTeamsCount(affected.length);
      setShowCurtainIntro(true);

      return ranked;
    });
  }, []);

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
          }

          // Also trigger authoritative database view refresh
          refreshLeaderboard();
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

      {/* 2. CINEMATIC VELVET CURTAIN INTRODUCTION (PLAYS ON CONFIRMED SCORING BATCH) */}
      {showCurtainIntro && (
        <CurtainReveal
          onComplete={handleCurtainComplete}
          headingFontClassName={headingFontClassName}
          updatedTeamsCount={updatedTeamsCount}
        />
      )}

      {/* Top Controls: Audio Sound Toggle, Skip Reveal (if active) & Fullscreen Mode */}
      <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
        {isSlotSpinning && (
          <button
            onClick={handleSkipReveal}
            title="Skip to final scores"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/20 hover:bg-gold/35 text-gold-bright border border-gold/40 text-xs font-mono uppercase tracking-wider backdrop-blur-md transition-all cursor-pointer shadow-lg animate-pulse"
          >
            <FastForward className="w-3.5 h-3.5" />
            <span>Skip Reveal</span>
          </button>
        )}

        <button
          onClick={toggleAudio}
          title={isAudioMuted ? "Enable Casino Audio" : "Mute Casino Audio"}
          className="p-2.5 rounded-xl bg-card/60 hover:bg-gold/25 text-neutral-300 hover:text-gold border border-gold/25 backdrop-blur-md transition-all cursor-pointer shadow-lg"
        >
          {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-gold animate-pulse" />}
        </button>

        <button
          onClick={toggleFullscreen}
          title="Toggle Fullscreen Presentation (or press 'F')"
          className="p-2.5 rounded-xl bg-card/60 hover:bg-gold/25 text-neutral-300 hover:text-gold border border-gold/25 backdrop-blur-md transition-all cursor-pointer shadow-lg"
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
          {/* Animated Live-Update Broadcast Indicator */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-950/70 border border-red-700/60 text-[10px] sm:text-xs tracking-widest text-red-200 uppercase font-mono font-bold backdrop-blur-md shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            <span>BROADCAST LIVE</span>
          </div>

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
        </div>
      </header>

      {/* DEDICATED LAYOUT REGION: CHAMPION ANNOUNCEMENT BANNER (ZERO OVERLAP WITH HEADING OR PODIUM) */}
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

      {/* MAIN STAGE: 3D Casino Podium + Remaining Teams Full-Width Leaderboard */}
      <main className="flex-1 flex flex-col justify-center my-auto relative z-20 max-w-6xl mx-auto w-full overflow-hidden">
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
                  <div
                    className={cn(
                      "w-full rounded-2xl border-2 border-slate-300/70 bg-gradient-to-b from-[#181d26]/95 via-[#0e1218]/95 to-[#06080c]/98 backdrop-blur-xl p-3 sm:p-5 text-center space-y-2 shadow-[0_10px_30px_rgba(0,0,0,0.7)] hover:border-slate-200 transition-all duration-500 relative overflow-hidden",
                      rankShifts[top2.team_id] && "animate-card-flip animate-rank-flash"
                    )}
                  >
                    {/* Metallic Shimmer Sweep */}
                    <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-white/8 to-transparent animate-shimmer-sweep" />

                    {/* Rank Shift Indicator */}
                    {rankShifts[top2.team_id] && (
                      <div className="absolute top-2 right-2 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald/20 text-emerald-300 border border-emerald/50 animate-bounce">
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

                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-300/20 border border-slate-300/60 text-slate-100 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(148,163,184,0.35)]">
                      <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-slate-100" />
                    </div>

                    <span className="text-[10px] sm:text-xs font-bold text-slate-300 uppercase tracking-widest block font-mono">
                      Rank 2 • Silver
                    </span>

                    <h3 className="text-sm sm:text-lg font-bold text-foreground truncate font-serif">
                      {top2.team_name}
                    </h3>

                    {/* Mechanical Slot Machine Number Reel for Rank 2 */}
                    <div className="pt-2 border-t border-slate-400/25 flex justify-center">
                      <SlotScoreReel
                        value={top2.total_score}
                        delta={scoreDeltas[top2.team_id] ?? null}
                        isSpinning={isSlotSpinning && affectedTeamIds.includes(top2.team_id)}
                        staggerDelay={1600}
                        variant="silver"
                      />
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
                      "w-full rounded-3xl border-2 border-[#f0c85a] bg-gradient-to-b from-[#281a08]/98 via-[#150d05]/98 to-[#060404]/98 backdrop-blur-xl p-4 sm:p-6 text-center space-y-2.5 transition-all duration-700 relative overflow-hidden",
                      crownCelebration
                        ? "ring-4 ring-gold shadow-[0_0_80px_rgba(240,200,90,0.85)] scale-105"
                        : "shadow-[0_0_55px_rgba(212,168,67,0.45)]",
                      rankShifts[top1.team_id] && "animate-card-flip animate-rank-flash"
                    )}
                  >
                    {/* Golden Shimmer Sweep */}
                    <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-gold/12 to-transparent animate-shimmer-sweep" />

                    {/* Rank Shift Indicator */}
                    {rankShifts[top1.team_id] && (
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-gold/30 text-gold-bright border border-gold shadow-lg animate-bounce">
                        <TrendingUp className="w-3.5 h-3.5 text-gold-bright" />
                        <span>NEW LEADER</span>
                      </div>
                    )}

                    {/* Gold Crown Badge with Aura */}
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

                    <h2 className="text-base sm:text-2xl font-black text-foreground truncate font-serif">
                      {top1.team_name}
                    </h2>

                    {/* Mechanical Slot Machine Number Reel for Rank 1 */}
                    <div className="pt-2.5 border-t border-gold/45 flex justify-center">
                      <SlotScoreReel
                        value={top1.total_score}
                        delta={scoreDeltas[top1.team_id] ?? null}
                        isSpinning={isSlotSpinning && affectedTeamIds.includes(top1.team_id)}
                        staggerDelay={1400}
                        variant="champion"
                      />
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
                  <div
                    className={cn(
                      "w-full rounded-2xl border-2 border-casino-red/70 bg-gradient-to-b from-[#280c10]/95 via-[#150608]/95 to-[#080204]/98 backdrop-blur-xl p-3 sm:p-5 text-center space-y-2 shadow-[0_10px_30px_rgba(0,0,0,0.7)] hover:border-casino-red transition-all duration-500 relative overflow-hidden",
                      rankShifts[top3.team_id] && "animate-card-flip animate-rank-flash"
                    )}
                  >
                    {/* Metallic Shimmer Sweep */}
                    <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-amber-400/8 to-transparent animate-shimmer-sweep" />

                    {/* Rank Shift Indicator */}
                    {rankShifts[top3.team_id] && (
                      <div className="absolute top-2 right-2 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/50 animate-bounce">
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

                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-casino-red/25 border border-casino-red/60 text-[#ffb399] flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(192,57,43,0.4)]">
                      <Medal className="w-5 h-5 sm:w-6 sm:h-6 text-[#ffb399]" />
                    </div>

                    <span className="text-[10px] sm:text-xs font-bold text-red-300 uppercase tracking-widest block font-mono">
                      Rank 3 • Bronze
                    </span>

                    <h3 className="text-sm sm:text-lg font-bold text-foreground truncate font-serif">
                      {top3.team_name}
                    </h3>

                    {/* Mechanical Slot Machine Number Reel for Rank 3 */}
                    <div className="pt-2 border-t border-casino-red/35 flex justify-center">
                      <SlotScoreReel
                        value={top3.total_score}
                        delta={scoreDeltas[top3.team_id] ?? null}
                        isSpinning={isSlotSpinning && affectedTeamIds.includes(top3.team_id)}
                        staggerDelay={1800}
                        variant="bronze"
                      />
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

            {/* REMAINING TEAMS: COMPLETE, ALIGNED CHAMPIONSHIP STANDINGS PANEL (#4 ONWARDS) */}
            {rest.length > 0 && (
              <div className="rounded-2xl border border-gold/30 bg-[#0c0810]/92 backdrop-blur-xl p-3 sm:p-4.5 max-w-6xl mx-auto w-full shadow-[0_12px_35px_rgba(0,0,0,0.85)] transition-all">
                <div
                  className={cn(
                    "grid gap-2 sm:gap-2.5 max-h-48 sm:max-h-60 lg:max-h-68 overflow-y-auto admin-scroll pr-1.5",
                    rest.length <= 4
                      ? "grid-cols-1 sm:grid-cols-2"
                      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                  )}
                >
                  {rest.map((team, idx) => {
                    const shift = rankShifts[team.team_id];
                    const isTeamSpinning = isSlotSpinning && affectedTeamIds.includes(team.team_id);
                    const teamDelta = scoreDeltas[team.team_id] ?? null;

                    return (
                      <div
                        key={team.team_id}
                        className={cn(
                          "h-14 sm:h-16 flex items-center justify-between px-3.5 sm:px-4 rounded-xl border border-white/10 bg-[#130b14]/85 hover:border-gold/50 hover:bg-[#1c0f1c]/90 transition-all duration-300 shadow-sm relative overflow-hidden",
                          shift && "border-gold/70 bg-gold/15 animate-card-flip"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/85 border border-gold/40 text-xs sm:text-sm font-mono font-bold text-gold-bright shrink-0 shadow-sm">
                            #{team.rank}
                          </span>

                          {/* Rank shift indicator */}
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

                          <div
                            className="w-3 h-3 rounded-full shrink-0 shadow-sm ring-1 ring-white/20"
                            style={{ backgroundColor: team.team_color || "#d4a843" }}
                          />

                          <span className="font-semibold text-xs sm:text-sm lg:text-base text-foreground truncate">
                            {team.team_name}
                          </span>
                        </div>

                        {/* Mechanical Slot Machine Number Reel for Remaining Teams */}
                        <div className="text-right shrink-0 pl-2">
                          <SlotScoreReel
                            value={team.total_score}
                            delta={teamDelta}
                            isSpinning={isTeamSpinning}
                            staggerDelay={1500 + idx * 180}
                            variant="standard"
                          />
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
