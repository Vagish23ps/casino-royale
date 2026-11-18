"use client";

import { useState, useMemo } from "react";
import {
  History,
  RotateCcw,
  Filter,
  Check,
  AlertCircle,
  X,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatAuditTimestamp } from "@/lib/utils";
import { reverseScoreTransactionAction } from "@/lib/actions";
import type { ScoreTransaction, Team, Round } from "@/lib/types";

type HistoryTransaction = ScoreTransaction & {
  team_name: string;
  round_name: string;
};

type HistoryManagerProps = {
  initialTransactions: HistoryTransaction[];
  teams: Team[];
  rounds: Round[];
  dbError: string | null;
};

export function HistoryManager({
  initialTransactions,
  teams,
  rounds,
  dbError,
}: HistoryManagerProps) {
  const [transactions, setTransactions] = useState<HistoryTransaction[]>(initialTransactions);
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [filterRound, setFilterRound] = useState<string>("all");
  const [filterOp, setFilterOp] = useState<string>("all");

  // Reversal modal
  const [reversingTx, setReversingTx] = useState<HistoryTransaction | null>(null);
  const [reversalReason, setReversalReason] = useState("Score entry calculation error");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(dbError);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Filtered transactions
  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (filterTeam !== "all" && tx.team_id !== filterTeam) return false;
      if (filterRound !== "all" && tx.round_id !== filterRound) return false;
      if (filterOp !== "all" && tx.operation_type !== filterOp) return false;
      return true;
    });
  }, [transactions, filterTeam, filterRound, filterOp]);

  // Reverse handler
  const handleConfirmReversal = async () => {
    if (!reversingTx) return;
    setLoading(true);
    setActionError(null);

    const res = await reverseScoreTransactionAction(reversingTx.id, reversalReason);
    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to reverse transaction in database");
    } else {
      setActionSuccess(`Transaction ${reversingTx.id.slice(0, 8)} successfully reversed.`);
      setTransactions((prev) =>
        prev.map((t) => (t.id === reversingTx.id ? { ...t, reason: `${t.reason || ""} [Reversed]` } : t))
      );
      setReversingTx(null);
      setTimeout(() => setActionSuccess(null), 5000);
    }
  };

  // CSV Export handler
  const exportCSV = () => {
    const headers = [
      "Transaction ID",
      "Timestamp",
      "Team Name",
      "Round",
      "Operation",
      "Input Value",
      "Previous Score",
      "Resulting Score",
      "Points Delta",
      "Created By",
      "Reason",
      "Reversal Of",
    ];

    const rows = filtered.map((tx) => [
      `"${tx.id}"`,
      `"${new Date(tx.created_at).toISOString()}"`,
      `"${tx.team_name.replace(/"/g, '""')}"`,
      `"${tx.round_name.replace(/"/g, '""')}"`,
      `"${tx.operation_type}"`,
      tx.input_value,
      tx.previous_score,
      tx.resulting_score,
      tx.points_delta,
      `"${tx.created_by || "organizer"}"`,
      `"${(tx.reason || "").replace(/"/g, '""')}"`,
      `"${tx.reversal_of_transaction_id || ""}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `casino-royale-ledger-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {actionError && (
        <div className="p-4 rounded-xl border border-casino-red/40 bg-casino-red/10 text-casino-red flex items-start justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Ledger Notice</p>
              <p className="mt-0.5 opacity-90">{actionError}</p>
            </div>
          </div>
          <button onClick={() => setActionError(null)} className="text-casino-red hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 rounded-xl border border-emerald/40 bg-emerald/10 text-emerald flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Bar & Export */}
      <div className="p-4 rounded-xl border border-border bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="w-3.5 h-3.5 text-gold" />
            <span>Filters:</span>
          </div>

          {/* Team filter */}
          <select
            value={filterTeam}
            onChange={(e) => setFilterTeam(e.target.value)}
            className="px-2.5 py-1 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:border-gold"
          >
            <option value="all">All Teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          {/* Round filter */}
          <select
            value={filterRound}
            onChange={(e) => setFilterRound(e.target.value)}
            className="px-2.5 py-1 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:border-gold"
          >
            <option value="all">All Rounds</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                Round {r.round_number}: {r.name}
              </option>
            ))}
          </select>

          {/* Operation filter */}
          <select
            value={filterOp}
            onChange={(e) => setFilterOp(e.target.value)}
            className="px-2.5 py-1 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:border-gold"
          >
            <option value="all">All Operations</option>
            <option value="ADD">ADD (+)</option>
            <option value="SUBTRACT">SUBTRACT (-)</option>
            <option value="MULTIPLY">MULTIPLY (×)</option>
            <option value="DIVIDE">DIVIDE (÷)</option>
            <option value="SET_SCORE">SET SCORE (=)</option>
          </select>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={exportCSV}
          disabled={filtered.length === 0}
          className="border-gold/40 text-gold hover:bg-gold/10 text-xs h-8 px-3 gap-1.5 shrink-0"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Export CSV ({filtered.length})
        </Button>
      </div>

      {/* Ledger Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden art-deco-corner">
        <div className="overflow-x-auto admin-scroll">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 border-b border-border text-[11px] text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Round</th>
                <th className="px-4 py-3">Operation</th>
                <th className="px-4 py-3">Input</th>
                <th className="px-4 py-3">Math (Prev → Result)</th>
                <th className="px-4 py-3">Delta</th>
                <th className="px-4 py-3">Audit Reason</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground font-sans">
                    <History className="w-6 h-6 mx-auto mb-2 opacity-40 text-gold" />
                    No transactions match your current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((tx) => {
                  const isReversal = Boolean(tx.reversal_of_transaction_id);

                  return (
                    <tr key={tx.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatAuditTimestamp(tx.created_at)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground font-sans whitespace-nowrap">
                        {tx.team_name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-sans">
                        {tx.round_name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant="outline" className="text-[10px] border-gold/30 text-gold">
                          {tx.operation_type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">
                        {tx.input_value}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {tx.previous_score.toLocaleString()} →{" "}
                        <span className="text-foreground font-semibold">
                          {tx.resulting_score.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold whitespace-nowrap">
                        <span
                          className={
                            tx.points_delta > 0
                              ? "text-emerald"
                              : tx.points_delta < 0
                              ? "text-casino-red"
                              : "text-muted-foreground"
                          }
                        >
                          {tx.points_delta > 0 ? `+${tx.points_delta}` : tx.points_delta}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate font-sans">
                        {tx.reason || "—"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isReversal ? (
                          <Badge className="bg-casino-red/10 text-casino-red border-casino-red/20 text-[9px]">
                            Reversal Tx
                          </Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={loading}
                            onClick={() => {
                              setReversingTx(tx);
                              setReversalReason(`Reversal of Tx ${tx.id.slice(0, 8)}`);
                            }}
                            className="text-xs text-casino-red hover:bg-casino-red/10 hover:text-casino-red h-6 px-2 gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reverse
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* REVERSAL CONFIRMATION MODAL */}
      {reversingTx && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-casino-red/40 bg-card p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-casino-red">
              <RotateCcw className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold uppercase tracking-wider font-serif">
                Confirm Transaction Reversal
              </h3>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              This will create an offsetting transaction that exactly negates the{" "}
              <span className="font-mono font-bold text-foreground">
                {reversingTx.points_delta > 0 ? `+${reversingTx.points_delta}` : reversingTx.points_delta}
              </span>{" "}
              points delta for <span className="font-bold text-foreground">{reversingTx.team_name}</span>.
              The original transaction remains in the immutable audit log.
            </p>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Reversal Audit Justification *
              </label>
              <input
                type="text"
                required
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="Reason for reversal..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:border-gold"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setReversingTx(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={loading || !reversalReason.trim()}
                onClick={handleConfirmReversal}
                className="bg-casino-red text-white hover:bg-casino-red-dim font-bold"
              >
                {loading ? "Reversing..." : "Execute Reversal"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
