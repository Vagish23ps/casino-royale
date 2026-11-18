import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import type { Round } from "@/lib/types";

type RoundOverviewProps = {
  rounds: Round[];
};

function statusBadge(status: Round["status"]) {
  switch (status) {
    case "active":
      return (
        <Badge className="bg-emerald/15 text-emerald border-emerald/20 text-[10px] uppercase tracking-wider">
          Active
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-muted text-muted-foreground border-border text-[10px] uppercase tracking-wider">
          Completed
        </Badge>
      );
    case "upcoming":
      return (
        <Badge className="bg-gold/15 text-gold border-gold/20 text-[10px] uppercase tracking-wider">
          Upcoming
        </Badge>
      );
    default:
      return null;
  }
}

export function RoundOverview({ rounds }: RoundOverviewProps) {
  if (rounds.length === 0) return null;

  return (
    <div className="space-y-2">
      {rounds.map((round) => (
        <div
          key={round.id}
          className={cn(
            "flex items-center justify-between px-4 py-3 rounded-lg border transition-colors",
            round.status === "active"
              ? "border-emerald/20 bg-emerald/5"
              : "border-border bg-card hover:bg-muted/30"
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-mono text-muted-foreground w-7 shrink-0">
              R{round.round_number}
            </span>
            <span className="text-sm font-medium text-foreground truncate">
              {round.name}
            </span>
          </div>
          {statusBadge(round.status)}
        </div>
      ))}
    </div>
  );
}
