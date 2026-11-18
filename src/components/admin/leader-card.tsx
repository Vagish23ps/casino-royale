import { Crown, Trophy } from "lucide-react";
import { cn } from "cn";

type LeaderCardProps = {
  teamName: string;
  score: number;
  rank: number;
  teamColor?: string | null;
};

export function LeaderCard({ teamName, score, rank, teamColor }: LeaderCardProps) {
  const isFirst = rank === 1;

  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border p-4 transition-colors",
        isFirst
          ? "border-gold/30 bg-gold/5"
          : "border-border bg-card hover:bg-muted/40"
      )}
    >
      {/* Rank badge */}
      <div
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg font-bold text-sm shrink-0",
          isFirst
            ? "bg-gold/15 text-gold"
            : rank === 2
              ? "bg-muted text-muted-foreground"
              : rank === 3
                ? "bg-muted text-muted-foreground"
                : "bg-muted text-muted-foreground"
        )}
      >
        {isFirst ? (
          <Crown className="w-5 h-5 text-gold" />
        ) : (
          <span>#{rank}</span>
        )}
      </div>

      {/* Team info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {teamColor && (
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: teamColor }}
            />
          )}
          <span
            className={cn(
              "font-semibold text-sm truncate",
              isFirst ? "text-gold" : "text-foreground"
            )}
          >
            {teamName}
          </span>
        </div>
      </div>

      {/* Score */}
      <div className="text-right shrink-0">
        <span
          className={cn(
            "text-lg font-bold tabular-nums",
            isFirst ? "text-gold" : "text-foreground"
          )}
        >
          {score.toLocaleString()}
        </span>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          points
        </p>
      </div>

      {isFirst && <Trophy className="w-4 h-4 text-gold/50 shrink-0" />}
    </div>
  );
}
