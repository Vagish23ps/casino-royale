"use client";

import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "cn";
import type { LeaderboardEntry } from "@/lib/types";
import { TeamNameplate } from "./team-nameplate";
import { SlotScoreReel } from "./slot-score-reel";
import type { RankShiftInfo } from "./podium-card";

export interface LeaderboardRowProps {
  team: LeaderboardEntry;
  rank: number;
  currentScore: number;
  scoreDelta: number | null;
  isSpinning: boolean;
  isShuffling: boolean;
  shiftInfo?: RankShiftInfo;
  staggerDelay: number;
  itemClass: string;
  onReelSettled: (teamId: string) => void;
}

export const LeaderboardRow = React.memo(function LeaderboardRow({
  team,
  rank,
  currentScore,
  scoreDelta,
  isSpinning,
  isShuffling,
  shiftInfo,
  staggerDelay,
  itemClass,
  onReelSettled,
}: LeaderboardRowProps) {
  const teamId = team.team_id;
  const handleSettled = React.useCallback(() => {
    onReelSettled(teamId);
  }, [teamId, onReelSettled]);

  return (
    <div
      key={teamId}
      className={cn(
        "h-14 sm:h-16 flex items-center justify-between px-3.5 sm:px-4 rounded-xl border border-white/10 bg-[#130b14]/85 hover:border-gold/50 hover:bg-[#1c0f1c]/90 transition-all duration-300 shadow-sm relative",
        shiftInfo && "border-gold/60 bg-gold/10",
        itemClass
      )}
    >
      {/* Fixed Stationary Rank Badge & Shift Indicator */}
      <div className="flex items-center gap-2.5 shrink-0 z-10">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/85 border border-gold/40 text-xs sm:text-sm font-mono font-bold text-gold-bright shrink-0 shadow-sm">
          #{rank}
        </span>

        {shiftInfo && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-[10px] sm:text-xs font-bold shrink-0 animate-bounce",
              shiftInfo.direction === "up" ? "text-emerald-400" : "text-casino-red"
            )}
          >
            {shiftInfo.direction === "up" ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            <span>
              {shiftInfo.direction === "up"
                ? `+${shiftInfo.from - shiftInfo.to}`
                : `-${shiftInfo.to - shiftInfo.from}`}
            </span>
          </span>
        )}
      </div>

      {/* THE SINGLE MOVABLE IDENTITY WRAPPER */}
      <div
        key={teamId}
        data-team-identity={teamId}
        className="flex items-center justify-between flex-1 min-w-0 pl-3 will-change-transform select-none relative"
      >
        <TeamNameplate
          teamId={teamId}
          teamName={team.team_name}
          teamColor={team.team_color}
          variant="standard"
          isShuffling={isShuffling}
          className="max-w-[210px] sm:max-w-[250px]"
        />

        <div className="text-right shrink-0">
          <SlotScoreReel
            value={currentScore}
            delta={scoreDelta}
            isSpinning={isSpinning}
            staggerDelay={staggerDelay}
            variant="standard"
            onSettled={handleSettled}
          />
        </div>
      </div>
    </div>
  );
});
