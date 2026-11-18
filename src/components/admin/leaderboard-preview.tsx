import { Crown, Trophy, Medal } from "lucide-react";
import { cn } from "cn";
import type { LeaderboardEntry } from "@/lib/types";

type LeaderboardPreviewProps = {
  entries: LeaderboardEntry[];
  maxEntries?: number;
};

export function LeaderboardPreview({ entries, maxEntries = 5 }: LeaderboardPreviewProps) {
  const displayEntries = entries.slice(0, maxEntries);

  if (displayEntries.length === 0) return null;

  return (
    <div className="space-y-2">
      {displayEntries.map((entry) => {
        const isFirst = entry.rank === 1;
        const isSecond = entry.rank === 2;
        const isThird = entry.rank === 3;

        return (
          <div
            key={entry.team_id}
            className={cn(
              "flex items-center justify-between p-3 rounded-lg border transition-all",
              isFirst
                ? "border-gold/30 bg-gold/5 shadow-[0_0_15px_rgba(212,168,67,0.05)]"
                : "border-border bg-card/60 hover:bg-card"
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg font-bold text-xs shrink-0",
                  isFirst
                    ? "bg-gold/20 text-gold"
                    : isSecond
                    ? "bg-slate-300/15 text-slate-300"
                    : isThird
                    ? "bg-amber-600/15 text-amber-500"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isFirst ? (
                  <Crown className="w-4 h-4 text-gold" />
                ) : isSecond ? (
                  <Trophy className="w-3.5 h-3.5 text-slate-300" />
                ) : isThird ? (
                  <Medal className="w-3.5 h-3.5 text-amber-500" />
                ) : (
                  <span>#{entry.rank}</span>
                )}
              </div>

              <div className="flex items-center gap-2 min-w-0">
                {entry.team_color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: entry.team_color }}
                  />
                )}
                <span
                  className={cn(
                    "text-sm font-semibold truncate",
                    isFirst ? "text-gold" : "text-foreground"
                  )}
                >
                  {entry.team_name}
                </span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span
                className={cn(
                  "text-sm font-bold tabular-nums",
                  isFirst ? "text-gold" : "text-foreground"
                )}
              >
                {entry.total_score.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground ml-1">pts</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
