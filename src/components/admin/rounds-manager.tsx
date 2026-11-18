"use client";

import { useState } from "react";
import {
  CircleDot,
  Plus,
  Play,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  Edit2,
  Trash2,
  RotateCcw,
  AlertCircle,
  Check,
  ShieldAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDeterministicDate } from "@/lib/utils";
import {
  createRoundAction,
  updateRoundNameAction,
  setRoundStatusAction,
  reorderRoundsAction,
  softDeleteRoundAction,
  restoreRoundAction,
} from "@/lib/actions";
import type { Round } from "@/lib/types";

type RoundsManagerProps = {
  initialActiveRounds: Round[];
  initialDeletedRounds: Round[];
  initialStats: Record<string, { transactionsCount: number; teamsParticipated: number }>;
  dbError: string | null;
};

export function RoundsManager({
  initialActiveRounds,
  initialDeletedRounds,
  initialStats,
  dbError,
}: RoundsManagerProps) {
  const [activeRounds, setActiveRounds] = useState<Round[]>(initialActiveRounds);
  const [deletedRounds, setDeletedRounds] = useState<Round[]>(initialDeletedRounds);

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<Round | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingRound, setDeletingRound] = useState<Round | null>(null);

  // Form values
  const [formName, setFormName] = useState("");

  // Feedback states
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(dbError);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  // Create round
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setLoading(true);
    setActionError(null);

    const res = await createRoundAction({ name: formName });
    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to create round");
    } else {
      if (res.round) {
        setActiveRounds((prev) => [...prev, res.round]);
      }
      setIsCreateOpen(false);
      setFormName("");
      showNotification(`Round "${formName}" created.`);
    }
  };

  // Edit round
  const handleEditOpen = (round: Round) => {
    setEditingRound(round);
    setFormName(round.name);
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRound || !formName.trim()) return;
    setLoading(true);
    setActionError(null);

    const res = await updateRoundNameAction(editingRound.id, formName);
    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to update round name");
    } else {
      setActiveRounds((prev) =>
        prev.map((r) => (r.id === editingRound.id ? { ...r, name: formName } : r))
      );
      setIsEditOpen(false);
      setEditingRound(null);
      showNotification(`Round name updated.`);
    }
  };

  // Status changes: Activate or Complete
  const handleStatusChange = async (roundId: string, status: "active" | "completed" | "upcoming") => {
    setLoading(true);
    setActionError(null);

    const res = await setRoundStatusAction(roundId, status);
    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to update round status");
    } else {
      setActiveRounds((prev) =>
        prev.map((r) => {
          if (r.id === roundId) {
            return { ...r, status };
          }
          // If another round was active and we activated roundId, previous active becomes completed
          if (status === "active" && r.status === "active") {
            return { ...r, status: "completed" };
          }
          return r;
        })
      );
      showNotification(`Round status updated to ${status}.`);
    }
  };

  // Delete round
  const handleDeleteConfirm = async () => {
    if (!deletingRound) return;
    setLoading(true);
    setActionError(null);

    const res = await softDeleteRoundAction(deletingRound.id);
    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to delete round");
    } else {
      setActiveRounds((prev) => prev.filter((r) => r.id !== deletingRound.id));
      setDeletedRounds((prev) => [
        { ...deletingRound, deleted_at: new Date().toISOString() },
        ...prev,
      ]);
      setIsDeleteOpen(false);
      showNotification(`Round "${deletingRound.name}" soft deleted.`);
      setDeletingRound(null);
    }
  };

  // Restore round
  const handleRestore = async (round: Round) => {
    setLoading(true);
    setActionError(null);

    const res = await restoreRoundAction(round.id);
    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to restore round");
    } else {
      setDeletedRounds((prev) => prev.filter((r) => r.id !== round.id));
      setActiveRounds((prev) => [...prev, { ...round, deleted_at: null }]);
      showNotification(`Round "${round.name}" restored.`);
    }
  };

  // Move up/down
  const handleMove = async (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= activeRounds.length) return;

    const newOrder = [...activeRounds];
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    // Update numbers locally
    const updated = newOrder.map((r, idx) => ({ ...r, round_number: idx + 1 }));
    setActiveRounds(updated);

    // Call server action to persist
    const res = await reorderRoundsAction(updated.map((r) => r.id));
    if (!res.success) {
      setActionError(res.error || "Failed to persist round reordering");
    } else {
      showNotification("Round sequence updated.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {actionError && (
        <div className="p-4 rounded-xl border border-casino-red/40 bg-casino-red/10 text-casino-red flex items-start justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Database Operation Notice</p>
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

      {/* Header Controls */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <span>Tournament Rounds Sequence</span>
            <Badge variant="outline" className="text-[10px] border-border text-foreground">
              {activeRounds.length} Rounds
            </Badge>
          </h2>
        </div>

        <Button
          onClick={() => {
            setFormName("");
            setIsCreateOpen(true);
          }}
          className="bg-gold text-charcoal hover:bg-gold-bright font-bold gap-1.5 text-xs h-9 px-3 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create New Round
        </Button>
      </div>

      {/* Rounds List */}
      {activeRounds.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center space-y-2">
          <CircleDot className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No Tournament Rounds</h3>
          <p className="text-xs text-muted-foreground">
            Create sequential gaming rounds (e.g. Baccarat, High-Roller Roulette, Blackjack Championship) to enable scoring.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeRounds.map((round, index) => {
            const stats = initialStats[round.id] || { transactionsCount: 0, teamsParticipated: 0 };

            return (
              <div
                key={round.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-border bg-card gap-4 hover:border-gold/30 transition-all art-deco-corner"
              >
                <div className="flex items-center gap-4">
                  {/* Up / Down Controls */}
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      disabled={index === 0 || loading}
                      onClick={() => handleMove(index, "up")}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20"
                      title="Move Up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      disabled={index === activeRounds.length - 1 || loading}
                      onClick={() => handleMove(index, "down")}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20"
                      title="Move Down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Round Badge */}
                  <div className="w-11 h-11 rounded-xl bg-gold/10 border border-gold/20 flex flex-col items-center justify-center shrink-0">
                    <span className="text-[9px] uppercase tracking-wider text-gold font-bold">R</span>
                    <span className="text-base font-bold text-foreground font-mono">{round.round_number}</span>
                  </div>

                  {/* Title & Status */}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground font-serif">{round.name}</h3>
                      {round.status === "active" && (
                        <Badge className="bg-emerald/15 text-emerald border-emerald/20 text-[9px] uppercase tracking-wider">
                          Live Active
                        </Badge>
                      )}
                      {round.status === "completed" && (
                        <Badge className="bg-muted text-muted-foreground border-border text-[9px] uppercase tracking-wider">
                          Completed
                        </Badge>
                      )}
                      {round.status === "upcoming" && (
                        <Badge className="bg-gold/15 text-gold border-gold/20 text-[9px] uppercase tracking-wider">
                          Upcoming
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                      <span className="font-mono">ID: {round.id.slice(0, 8)}</span>
                      <span>•</span>
                      <span>{stats.transactionsCount} transactions</span>
                      <span>•</span>
                      <span>{stats.teamsParticipated} teams scored</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  {round.status !== "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loading}
                      onClick={() => handleStatusChange(round.id, "active")}
                      className="border-emerald/40 text-emerald hover:bg-emerald/10 text-xs h-8 px-2.5 gap-1.5"
                    >
                      <Play className="w-3 h-3" />
                      Set Active
                    </Button>
                  )}

                  {round.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loading}
                      onClick={() => handleStatusChange(round.id, "completed")}
                      className="border-gold/40 text-gold hover:bg-gold/10 text-xs h-8 px-2.5 gap-1.5"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Complete Round
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleEditOpen(round)}
                    className="text-muted-foreground hover:text-foreground h-8 w-8"
                    title="Edit Round Name"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setDeletingRound(round);
                      setIsDeleteOpen(true);
                    }}
                    className="text-casino-red/80 hover:text-casino-red hover:bg-casino-red/10 h-8 w-8"
                    title="Delete Round"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recently Deleted Rounds Section */}
      {deletedRounds.length > 0 && (
        <div className="pt-6 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-casino-red flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5" />
              Recently Deleted Rounds ({deletedRounds.length})
            </h3>
            <span className="text-[11px] text-muted-foreground">
              Scores preserved in ledger
            </span>
          </div>

          <div className="divide-y divide-border rounded-xl border border-border bg-card/60 overflow-hidden">
            {deletedRounds.map((round) => (
              <div
                key={round.id}
                className="p-3.5 flex items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
              >
                <div>
                  <h4 className="text-xs font-semibold text-foreground line-through opacity-75">
                    Round {round.round_number}: {round.name}
                  </h4>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    Deleted: {formatDeterministicDate(round.deleted_at)}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => handleRestore(round)}
                  className="text-xs border-gold/40 text-gold hover:bg-gold/10 h-7 px-2.5 gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restore Round
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CREATE ROUND MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-gold/40 bg-card p-6 space-y-5 art-deco-corner shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground font-serif uppercase">
                Create Tournament Round
              </h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Round Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. High-Roller Roulette Championship"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:border-gold"
                />
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} size="sm" className="bg-gold text-charcoal hover:bg-gold-bright font-bold">
                  {loading ? "Creating..." : "Create Round"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT ROUND MODAL */}
      {isEditOpen && editingRound && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-gold/40 bg-card p-6 space-y-5 art-deco-corner shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground font-serif uppercase">
                Edit Round {editingRound.round_number}
              </h3>
              <button onClick={() => setIsEditOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Round Name *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:border-gold"
                />
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} size="sm" className="bg-gold text-charcoal hover:bg-gold-bright font-bold">
                  {loading ? "Saving..." : "Save Name"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE ROUND MODAL */}
      {isDeleteOpen && deletingRound && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-casino-red/40 bg-card p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-casino-red">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Delete Round Confirmation</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to soft delete Round {deletingRound.round_number}:{" "}
              <span className="font-bold text-foreground">&ldquo;{deletingRound.name}&rdquo;</span>?
              Historical transactions associated with this round will remain intact in the score ledger, and the round can be restored at any time.
            </p>
            <div className="pt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={loading}
                onClick={handleDeleteConfirm}
                className="bg-casino-red text-white hover:bg-casino-red-dim font-bold"
              >
                {loading ? "Deleting..." : "Soft Delete Round"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
