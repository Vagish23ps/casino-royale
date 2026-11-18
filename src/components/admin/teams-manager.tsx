"use client";

import { useState } from "react";
import {
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  RotateCcw,
  BarChart2,
  AlertCircle,
  Check,
  ShieldAlert,
  X,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDeterministicDate } from "@/lib/utils";
import {
  createTeamAction,
  updateTeamAction,
  softDeleteTeamAction,
  restoreTeamAction,
} from "@/lib/actions";
import type { Team, TeamRoundScore } from "@/lib/types";

const CASINO_COLORS = [
  { label: "Royal Gold", hex: "#d4a843" },
  { label: "Casino Crimson", hex: "#c0392b" },
  { label: "Emerald Felt", hex: "#27ae60" },
  { label: "Sapphire Blue", hex: "#2980b9" },
  { label: "Imperial Purple", hex: "#8e44ad" },
  { label: "Highroller Orange", hex: "#d35400" },
  { label: "Charcoal Slate", hex: "#34495e" },
];

type TeamsManagerProps = {
  initialActiveTeams: Team[];
  initialDeletedTeams: Team[];
  initialScores: Record<string, { total: number; roundScores: TeamRoundScore[] }>;
  dbError: string | null;
};

export function TeamsManager({
  initialActiveTeams,
  initialDeletedTeams,
  initialScores,
  dbError,
}: TeamsManagerProps) {
  const [activeTeams, setActiveTeams] = useState<Team[]>(initialActiveTeams);
  const [deletedTeams, setDeletedTeams] = useState<Team[]>(initialDeletedTeams);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
  const [viewingProfileTeam, setViewingProfileTeam] = useState<Team | null>(null);

  // Form values
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState("#d4a843");
  const [formAvatar, setFormAvatar] = useState("");

  // Feedback states
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(dbError);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const filteredTeams = activeTeams.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Create team handler
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setLoading(true);
    setActionError(null);

    const res = await createTeamAction({
      name: formName,
      color: formColor,
      avatar_url: formAvatar || undefined,
    });

    setLoading(false);
    if (!res.success) {
      setActionError(res.error || "Failed to create team in database");
    } else {
      if (res.team) {
        setActiveTeams((prev) => [...prev, res.team]);
      }
      setIsCreateOpen(false);
      setFormName("");
      showNotification(`Team "${formName}" created successfully.`);
    }
  };

  // Edit team handler
  const handleEditOpen = (team: Team) => {
    setEditingTeam(team);
    setFormName(team.name);
    setFormColor(team.color || "#d4a843");
    setFormAvatar(team.avatar_url || "");
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam || !formName.trim()) return;
    setLoading(true);
    setActionError(null);

    const res = await updateTeamAction(editingTeam.id, {
      name: formName,
      color: formColor,
      avatar_url: formAvatar || undefined,
    });

    setLoading(false);
    if (!res.success) {
      setActionError(res.error || "Failed to update team");
    } else {
      setActiveTeams((prev) =>
        prev.map((t) => (t.id === editingTeam.id ? { ...t, name: formName, color: formColor } : t))
      );
      setIsEditOpen(false);
      setEditingTeam(null);
      showNotification(`Team "${formName}" updated.`);
    }
  };

  // Soft delete handler
  const handleDeleteConfirm = async () => {
    if (!deletingTeam) return;
    setLoading(true);
    setActionError(null);

    const res = await softDeleteTeamAction(deletingTeam.id);
    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to delete team");
    } else {
      setActiveTeams((prev) => prev.filter((t) => t.id !== deletingTeam.id));
      setDeletedTeams((prev) => [
        { ...deletingTeam, deleted_at: new Date().toISOString() },
        ...prev,
      ]);
      setIsDeleteOpen(false);
      showNotification(`Team "${deletingTeam.name}" moved to Recently Deleted.`);
      setDeletingTeam(null);
    }
  };

  // Restore handler
  const handleRestore = async (team: Team) => {
    setLoading(true);
    setActionError(null);

    const res = await restoreTeamAction(team.id);
    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to restore team");
    } else {
      setDeletedTeams((prev) => prev.filter((t) => t.id !== team.id));
      setActiveTeams((prev) => [...prev, { ...team, deleted_at: null }]);
      showNotification(`Team "${team.name}" restored to active tournament.`);
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
              <p className="font-semibold">Backend Database Error</p>
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

      {/* Top Controls: Search and Add */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search teams by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:border-gold"
          />
        </div>

        <Button
          onClick={() => {
            setFormName("");
            setFormColor("#d4a843");
            setIsCreateOpen(true);
          }}
          className="bg-gold text-charcoal hover:bg-gold-bright font-bold gap-1.5 text-xs h-10 px-4 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Enroll New Team
        </Button>
      </div>

      {/* Active Teams Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <span>Active Tournament Teams</span>
            <Badge variant="outline" className="text-[10px] border-border text-foreground">
              {filteredTeams.length}
            </Badge>
          </h2>
        </div>

        {filteredTeams.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center space-y-2">
            <Users className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
            <h3 className="text-sm font-semibold text-foreground">No Teams Found</h3>
            <p className="text-xs text-muted-foreground">
              {searchQuery ? "No teams matched your query." : "No teams are currently enrolled in this gala."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTeams.map((team) => {
              const scoreInfo = initialScores[team.id] || { total: 10000, roundScores: [] };

              return (
                <div
                  key={team.id}
                  className="rounded-xl border border-border bg-card p-4 space-y-4 hover:border-gold/40 transition-all art-deco-corner relative"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-md text-sm shrink-0"
                        style={{ backgroundColor: team.color || "#d4a843" }}
                      >
                        {team.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-foreground text-sm truncate max-w-[150px] font-serif">
                          {team.name}
                        </h3>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          ID: {team.id.slice(0, 8)}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-base font-bold font-mono text-gold tabular-nums">
                        {scoreInfo.total.toLocaleString()}
                      </span>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                        chips
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingProfileTeam(team)}
                      className="text-xs text-muted-foreground hover:text-foreground h-7 px-2 gap-1"
                    >
                      <BarChart2 className="w-3.5 h-3.5 text-gold" />
                      Rounds
                    </Button>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleEditOpen(team)}
                        className="text-muted-foreground hover:text-foreground h-7 w-7"
                        title="Edit Team"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setDeletingTeam(team);
                          setIsDeleteOpen(true);
                        }}
                        className="text-casino-red/80 hover:text-casino-red hover:bg-casino-red/10 h-7 w-7"
                        title="Delete Team"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recently Deleted Section */}
      {deletedTeams.length > 0 && (
        <div className="pt-6 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-casino-red flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5" />
              Recently Deleted Teams ({deletedTeams.length})
            </h3>
            <span className="text-[11px] text-muted-foreground">
              Scores preserved in ledger
            </span>
          </div>

          <div className="divide-y divide-border rounded-xl border border-border bg-card/60 overflow-hidden">
            {deletedTeams.map((team) => (
              <div
                key={team.id}
                className="p-3.5 flex items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-white text-xs opacity-60"
                    style={{ backgroundColor: team.color || "#666" }}
                  >
                    {team.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-foreground line-through opacity-75">
                      {team.name}
                    </h4>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      Deleted: {formatDeterministicDate(team.deleted_at)}
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => handleRestore(team)}
                  className="text-xs border-gold/40 text-gold hover:bg-gold/10 h-7 px-2.5 gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CREATE TEAM MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-gold/40 bg-card p-6 space-y-5 art-deco-corner shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground font-serif uppercase">
                Enroll New VIP Team
              </h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Team Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Monte Carlo Aces"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:border-gold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-gold" />
                  Livery Color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {CASINO_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setFormColor(c.hex)}
                      className="w-7 h-7 rounded-full border-2 transition-transform"
                      style={{
                        backgroundColor: c.hex,
                        borderColor: formColor === c.hex ? "#fff" : "transparent",
                        transform: formColor === c.hex ? "scale(1.15)" : "scale(1)",
                      }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} size="sm" className="bg-gold text-charcoal hover:bg-gold-bright font-bold">
                  {loading ? "Enrolling..." : "Enroll Team"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT TEAM MODAL */}
      {isEditOpen && editingTeam && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-gold/40 bg-card p-6 space-y-5 art-deco-corner shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground font-serif uppercase">
                Edit Team: {editingTeam.name}
              </h3>
              <button onClick={() => setIsEditOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Team Name *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:border-gold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-gold" />
                  Livery Color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {CASINO_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setFormColor(c.hex)}
                      className="w-7 h-7 rounded-full border-2 transition-transform"
                      style={{
                        backgroundColor: c.hex,
                        borderColor: formColor === c.hex ? "#fff" : "transparent",
                        transform: formColor === c.hex ? "scale(1.15)" : "scale(1)",
                      }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} size="sm" className="bg-gold text-charcoal hover:bg-gold-bright font-bold">
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {isDeleteOpen && deletingTeam && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-casino-red/40 bg-card p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-casino-red">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Confirm Soft Deletion</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to soft delete{" "}
              <span className="font-bold text-foreground">&ldquo;{deletingTeam.name}&rdquo;</span>?
              All score transaction records and history will be preserved, and the team can be restored at any time.
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
                {loading ? "Deleting..." : "Soft Delete Team"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW PROFILE & ROUND-WISE PERFORMANCE MODAL */}
      {viewingProfileTeam && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gold/40 bg-card p-6 space-y-5 art-deco-corner shadow-2xl max-h-[85vh] overflow-y-auto admin-scroll">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-md text-sm"
                  style={{ backgroundColor: viewingProfileTeam.color || "#d4a843" }}
                >
                  {viewingProfileTeam.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground font-serif">
                    {viewingProfileTeam.name}
                  </h3>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    ID: {viewingProfileTeam.id}
                  </p>
                </div>
              </div>
              <button onClick={() => setViewingProfileTeam(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Overall Score */}
            <div className="p-4 rounded-xl border border-gold/30 bg-gold/5 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Overall Tournament Score
              </span>
              <span className="text-2xl font-bold font-mono text-gold">
                {(initialScores[viewingProfileTeam.id]?.total || 10000).toLocaleString()} chips
              </span>
            </div>

            {/* Round-wise Breakdown */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Round-Wise Performance
              </h4>

              {initialScores[viewingProfileTeam.id]?.roundScores.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No rounds recorded for this team yet.
                </p>
              ) : (
                <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-background/50">
                  {initialScores[viewingProfileTeam.id]?.roundScores.map((r) => (
                    <div key={r.round_id} className="p-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground">
                            R{r.round_number}: {r.round_name}
                          </span>
                          {r.has_score_reset && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-500 font-medium">
                              Score Override
                            </span>
                          )}
                          {r.has_reversal && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-500 font-medium">
                              Reversal
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {r.transactions_count} score transactions
                          {(r.has_score_reset || r.has_reversal) && typeof r.earned_points === "number" && (
                            <span> • Gameplay: {r.earned_points > 0 ? `+${r.earned_points}` : r.earned_points}</span>
                          )}
                        </p>
                      </div>
                      <span
                        className={
                          r.points_delta > 0
                            ? "text-emerald font-mono font-bold"
                            : r.points_delta < 0
                            ? "text-casino-red font-mono font-bold"
                            : "text-muted-foreground font-mono"
                        }
                      >
                        {r.points_delta > 0 ? `+${r.points_delta}` : r.points_delta}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setViewingProfileTeam(null)}>
                Close Profile
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
