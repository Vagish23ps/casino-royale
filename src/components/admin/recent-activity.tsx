import { cn, formatAuditTimestamp } from "@/lib/utils";
import { Plus, Minus, X as MultiplyIcon, Divide, Edit3, RotateCcw } from "lucide-react";
import type { ScoreTransaction } from "@/lib/types";

type RecentActivityProps = {
  transactions: (ScoreTransaction & { team_name?: string })[];
};

function getOperationBadge(op: ScoreTransaction["operation_type"]) {
  switch (op) {
    case "ADD":
      return {
        icon: Plus,
        color: "text-emerald bg-emerald/15 border-emerald/20",
        label: "+",
      };
    case "SUBTRACT":
      return {
        icon: Minus,
        color: "text-casino-red bg-casino-red/15 border-casino-red/20",
        label: "-",
      };
    case "MULTIPLY":
      return {
        icon: MultiplyIcon,
        color: "text-gold bg-gold/15 border-gold/20",
        label: "×",
      };
    case "DIVIDE":
      return {
        icon: Divide,
        color: "text-sky-400 bg-sky-400/15 border-sky-400/20",
        label: "÷",
      };
    case "SET_SCORE":
      return {
        icon: Edit3,
        color: "text-purple-400 bg-purple-400/15 border-purple-400/20",
        label: "=",
      };
    default:
      return {
        icon: Edit3,
        color: "text-muted-foreground bg-muted border-border",
        label: "•",
      };
  }
}

export function RecentActivity({ transactions }: RecentActivityProps) {
  if (transactions.length === 0) return null;

  return (
    <div className="space-y-3">
      {transactions.map((tx) => {
        const op = getOperationBadge(tx.operation_type);
        const Icon = op.icon;
        const isReversal = Boolean(tx.reversal_of_transaction_id);

        return (
          <div
            key={tx.id}
            className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/60 hover:bg-card transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg border shrink-0 font-bold text-xs",
                  op.color
                )}
              >
                {isReversal ? <RotateCcw className="w-3.5 h-3.5 text-casino-red" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">
                    {tx.team_name || "Team " + tx.team_id.slice(0, 6)}
                  </span>
                  {isReversal && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-casino-red/10 text-casino-red font-medium">
                      Reversal
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {tx.reason || `${tx.operation_type} ${tx.input_value}`}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span
                className={cn(
                  "text-sm font-bold tabular-nums",
                  tx.points_delta > 0
                    ? "text-emerald"
                    : tx.points_delta < 0
                    ? "text-casino-red"
                    : "text-muted-foreground"
                )}
              >
                {tx.points_delta > 0 ? `+${tx.points_delta}` : tx.points_delta}
              </span>
              <p className="text-[10px] text-muted-foreground">
                {formatAuditTimestamp(tx.created_at, false)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
