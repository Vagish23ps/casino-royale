"use client";

import React from "react";
import { Crown, Trophy, Medal, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "cn";
import type { LeaderboardEntry } from "@/lib/types";
import { TeamNameplate } from "./team-nameplate";
import { SlotScoreReel } from "./slot-score-reel";

export interface RankShiftInfo {
  from: number;
  to: number;
  direction: "up" | "down";
}

export interface PodiumCardProps {
  variant: "champion" | "silver" | "bronze";
  team: LeaderboardEntry | null;
  currentScore: number;
  scoreDelta: number | null;
  isSpinning: boolean;
  isShuffling: boolean;
  shiftInfo?: RankShiftInfo;
  crownCelebration?: boolean;
  staggerDelay: number;
  onReelSettled: (teamId: string) => void;
}

export const PodiumCard = React.memo(function PodiumCard({
  variant,
  team,
  currentScore,
  scoreDelta,
  isSpinning,
  isShuffling,
  shiftInfo,
  crownCelebration = false,
  staggerDelay,
  onReelSettled,
}: PodiumCardProps) {
  const teamId = team?.team_id;
  const handleSettled = React.useCallback(() => {
    if (teamId) {
      onReelSettled(teamId);
    }
  }, [teamId, onReelSettled]);

  if (!team) {
    const fallbackHeight = variant === "champion" ? "h-40" : "h-32";
    const fallbackBorder =
      variant === "champion"
        ? "border-gold/40 text-gold"
        : variant === "silver"
        ? "border-slate-300/40 text-slate-300"
        : "border-casino-red/40 text-casino-red";
    const label = variant === "champion" ? "Rank 1" : variant === "silver" ? "Rank 2" : "Rank 3";

    return (
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-full rounded-2xl border border-dashed flex items-center justify-center text-xs uppercase",
            fallbackHeight,
            fallbackBorder
          )}
        >
          {label}
        </div>
      </div>
    );
  }

  const resolvedTeamId = team.team_id;

  if (variant === "champion") {
    return (
      <div className="flex flex-col items-center -translate-y-3 sm:-translate-y-7 transition-all duration-700 ease-out z-10 relative">
        {/* Golden Spotlight from above illuminating Rank 1 */}
        <div className="absolute -top-36 left-1/2 -translate-x-1/2 w-72 sm:w-88 h-[400px] bg-gradient-to-b from-amber-200/25 via-gold/15 to-transparent blur-2xl pointer-events-none animate-champion-spotlight -z-10" />

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
          {shiftInfo && (
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

          {/* THE SINGLE MOVABLE IDENTITY WRAPPER */}
          <div
            key={resolvedTeamId}
            data-team-identity={resolvedTeamId}
            className="space-y-2.5 flex flex-col items-center w-full will-change-transform select-none relative"
          >
            <TeamNameplate
              teamId={resolvedTeamId}
              teamName={team.team_name}
              teamColor={team.team_color}
              variant="champion"
              isShuffling={isShuffling}
              className="w-full max-w-[220px] sm:max-w-[270px]"
            />

            {/* Mechanical Slot Machine Number Reel for Rank 1 */}
            <div className="pt-2.5 border-t border-gold/45 flex justify-center w-full">
              <SlotScoreReel
                value={currentScore}
                delta={scoreDelta}
                isSpinning={isSpinning}
                staggerDelay={staggerDelay}
                variant="champion"
                onSettled={handleSettled}
              />
            </div>
          </div>
        </div>

        {/* Royal Gold Pedestal Base */}
        <div className="hidden sm:block w-5/6 h-6 bg-gradient-to-r from-gold/30 via-gold/60 to-gold/30 border-x border-b border-gold/70 rounded-b-2xl shadow-[0_8px_25px_rgba(212,168,67,0.4)] animate-pedestal-gold" />
      </div>
    );
  }

  if (variant === "silver") {
    return (
      <div className="flex flex-col items-center transition-all duration-700 ease-out">
        <div className="w-full rounded-2xl border-2 border-slate-300/70 bg-gradient-to-b from-[#181d26]/95 via-[#0e1218]/95 to-[#06080c]/98 backdrop-blur-xl p-3 sm:p-5 text-center space-y-2 shadow-[0_10px_30px_rgba(0,0,0,0.7)] hover:border-slate-200 transition-all duration-500 relative">
          {/* Metallic Shimmer Sweep in inner clipped container */}
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-white/8 to-transparent animate-shimmer-sweep" />
          </div>

          {/* Rank Shift Indicator */}
          {shiftInfo && (
            <div className="absolute top-2 right-2 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald/20 text-emerald-300 border border-emerald/50 animate-bounce z-20">
              {shiftInfo.direction === "up" ? (
                <TrendingUp className="w-3 h-3 text-emerald-400" />
              ) : (
                <TrendingDown className="w-3 h-3 text-casino-red" />
              )}
              <span>
                {shiftInfo.direction === "up"
                  ? `▲ ${shiftInfo.from - shiftInfo.to}`
                  : `▼ ${shiftInfo.to - shiftInfo.from}`}
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

          {/* THE SINGLE MOVABLE IDENTITY WRAPPER */}
          <div
            key={resolvedTeamId}
            data-team-identity={resolvedTeamId}
            className="space-y-2 flex flex-col items-center w-full will-change-transform select-none relative"
          >
            <TeamNameplate
              teamId={resolvedTeamId}
              teamName={team.team_name}
              teamColor={team.team_color}
              variant="silver"
              isShuffling={isShuffling}
              className="w-full max-w-[210px] sm:max-w-[250px]"
            />

            {/* Mechanical Slot Machine Number Reel for Rank 2 */}
            <div className="pt-2 border-t border-slate-400/25 flex justify-center w-full">
              <SlotScoreReel
                value={currentScore}
                delta={scoreDelta}
                isSpinning={isSpinning}
                staggerDelay={staggerDelay}
                variant="silver"
                onSettled={handleSettled}
              />
            </div>
          </div>
        </div>

        {/* Silver Pedestal Base */}
        <div className="hidden sm:block w-4/5 h-4 bg-gradient-to-r from-slate-400/20 via-slate-300/40 to-slate-400/20 border-x border-b border-slate-300/50 rounded-b-xl shadow-md" />
      </div>
    );
  }

  // Bronze variant (Rank 3)
  return (
    <div className="flex flex-col items-center transition-all duration-700 ease-out">
      <div className="w-full rounded-2xl border-2 border-casino-red/70 bg-gradient-to-b from-[#280c10]/95 via-[#150608]/95 to-[#080204]/98 backdrop-blur-xl p-3 sm:p-5 text-center space-y-2 shadow-[0_10px_30px_rgba(0,0,0,0.7)] hover:border-casino-red transition-all duration-500 relative">
        {/* Metallic Shimmer Sweep in inner clipped container */}
        <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-amber-400/8 to-transparent animate-shimmer-sweep" />
        </div>

        {/* Rank Shift Indicator */}
        {shiftInfo && (
          <div className="absolute top-2 right-2 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/50 animate-bounce z-20">
            {shiftInfo.direction === "up" ? (
              <TrendingUp className="w-3 h-3 text-amber-400" />
            ) : (
              <TrendingDown className="w-3 h-3 text-casino-red" />
            )}
            <span>
              {shiftInfo.direction === "up"
                ? `▲ ${shiftInfo.from - shiftInfo.to}`
                : `▼ ${shiftInfo.to - shiftInfo.from}`}
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

        {/* THE SINGLE MOVABLE IDENTITY WRAPPER */}
        <div
          key={resolvedTeamId}
          data-team-identity={resolvedTeamId}
          className="space-y-2 flex flex-col items-center w-full will-change-transform select-none relative"
        >
          <TeamNameplate
            teamId={resolvedTeamId}
            teamName={team.team_name}
            teamColor={team.team_color}
            variant="bronze"
            isShuffling={isShuffling}
            className="w-full max-w-[210px] sm:max-w-[250px]"
          />

          {/* Mechanical Slot Machine Number Reel for Rank 3 */}
          <div className="pt-2 border-t border-casino-red/35 flex justify-center w-full">
            <SlotScoreReel
              value={currentScore}
              delta={scoreDelta}
              isSpinning={isSpinning}
              staggerDelay={staggerDelay}
              variant="bronze"
              onSettled={handleSettled}
            />
          </div>
        </div>
      </div>

      {/* Bronze / Red Pedestal Base */}
      <div className="hidden sm:block w-4/5 h-4 bg-gradient-to-r from-casino-red/30 via-amber-600/40 to-casino-red/30 border-x border-b border-casino-red/50 rounded-b-xl shadow-md" />
    </div>
  );
});
