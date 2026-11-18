"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Crosshair,
  Check,
  AlertCircle,
  Shield,
  Trash2,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { recordScoreBatchAction } from "@/lib/actions";
import type { Round, Team, ScoreOperationInput } from "@/lib/types";

export const PENDING_BATCH_STORAGE_KEY = "casino_royale_pending_score_batch";

type Operation = "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "SET_SCORE";

export type TeamRowState = {
  operation: Operation;
  inputValue: string;
  reason: string;
  staged: boolean;
};

export type PendingScoreBatch = {
  idempotencyKey: string;
  roundId: string;
  batchReason: string;
  rowStates: Record<string, TeamRowState>;
  timestamp: number;
  status: "staged" | "submitting" | "failed";
};

type ScoreControlManagerProps = {
  initialRounds: Round[];
  initialTeams: Team[];
  initialScores: Record<string, number>;
  allowNegativeScores?: boolean;
  dbError: string | null;
};

export function ScoreControlManager({
  initialRounds,
  initialTeams,
  initialScores,
  allowNegativeScores = false,
  dbError,
}: ScoreControlManagerProps) {
  // Find active round as initial selection, or first round
  const defaultRound = initialRounds.find((r) => r.status === "active") || initialRounds[0] || null;
  const [selectedRoundId, setSelectedRoundId] = useState<string>(defaultRound?.id || "");
  const [teamScores, setTeamScores] = useState<Record<string, number>>(initialScores);

  // Per-team row state
  const [rowStates, setRowStates] = useState<Record<string, TeamRowState>>(() => {
    const init: Record<string, TeamRowState> = {};
    initialTeams.forEach((t) => {
      init[t.id] = {
        operation: "ADD",
        inputValue: "",
        reason: "",
        staged: false,
      };
    });
    return init;
  });

  const [batchReason, setBatchReason] = useState("Round Scoring Settlement");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(dbError);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [batchIdempotencyKey, setBatchIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [restoredNotice, setRestoredNotice] = useState<string | null>(null);

  // Mount: restore pending batch if one was in-flight or failed prior to refresh
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(PENDING_BATCH_STORAGE_KEY);
        if (!raw) return;
        const parsed: PendingScoreBatch = JSON.parse(raw);
        if (parsed && parsed.idempotencyKey && parsed.rowStates) {
          setBatchIdempotencyKey(parsed.idempotencyKey);
          if (parsed.roundId) setSelectedRoundId(parsed.roundId);
          if (parsed.batchReason) setBatchReason(parsed.batchReason);
          setRowStates(parsed.rowStates);

          if (parsed.status === "submitting" || parsed.status === "failed") {
            setRestoredNotice(
              "An unconfirmed score batch was recovered from your previous session. " +
              "The original idempotency key has been restored to ensure retrying cannot create duplicate transactions."
            );
          }
        }
      } catch {
        // Safe fallback if localStorage is disabled or corrupt
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Helper to update a row's state (new input = new payload = fresh UUID)
  const updateRow = (teamId: string, partial: Partial<TeamRowState>) => {
    const nextKey = crypto.randomUUID();
    setBatchIdempotencyKey(nextKey);
    setRestoredNotice(null);
    setRowStates((prev) => {
      const next = {
        ...prev,
        [teamId]: {
          ...(prev[teamId] || { operation: "ADD", inputValue: "", reason: "", staged: false }),
          ...partial,
        },
      };

      try {
        const hasStaged = Object.values(next).some((s) => s.staged && s.inputValue.trim() !== "");
        if (hasStaged) {
          const rec: PendingScoreBatch = {
            idempotencyKey: nextKey,
            roundId: selectedRoundId,
            batchReason,
            rowStates: next,
            timestamp: Date.now(),
            status: "staged",
          };
          localStorage.setItem(PENDING_BATCH_STORAGE_KEY, JSON.stringify(rec));
        }
      } catch {}

      return next;
    });
  };

  const handleRoundChange = (roundId: string) => {
    setSelectedRoundId(roundId);
    setRestoredNotice(null);
    const nextKey = crypto.randomUUID();
    setBatchIdempotencyKey(nextKey);
    try {
      const rec: PendingScoreBatch = {
        idempotencyKey: nextKey,
        roundId,
        batchReason,
        rowStates,
        timestamp: Date.now(),
        status: "staged",
      };
      localStorage.setItem(PENDING_BATCH_STORAGE_KEY, JSON.stringify(rec));
    } catch {}
  };

  const handleReasonChange = (reason: string) => {
    setBatchReason(reason);
    setRestoredNotice(null);
    const nextKey = crypto.randomUUID();
    setBatchIdempotencyKey(nextKey);
    try {
      const rec: PendingScoreBatch = {
        idempotencyKey: nextKey,
        roundId: selectedRoundId,
        batchReason: reason,
        rowStates,
        timestamp: Date.now(),
        status: "staged",
      };
      localStorage.setItem(PENDING_BATCH_STORAGE_KEY, JSON.stringify(rec));
    } catch {}
  };

  // Explicitly abandon/discard pending batch
  const handleAbandonBatch = () => {
    try {
      localStorage.removeItem(PENDING_BATCH_STORAGE_KEY);
    } catch {}
    const newKey = crypto.randomUUID();
    setBatchIdempotencyKey(newKey);
    setRestoredNotice(null);
    setActionError(null);
    setRowStates((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((teamId) => {
        next[teamId] = {
          operation: "ADD",
          inputValue: "",
          reason: "",
          staged: false,
        };
      });
      return next;
    });
  };

  // Compute provisional math for a team
  const calculateProvisional = useCallback(
    (currentScore: number, op: Operation, inputStr: string) => {
      const trimmed = inputStr.trim();
      const val = parseFloat(trimmed);
      if (isNaN(val) || trimmed === "") {
        return { resulting: currentScore, delta: 0, isValid: false, error: null };
      }

      // Enforce strict 2-decimal precision (prevents silent rounding)
      if (/\.[0-9]{3,}$/.test(trimmed)) {
        return {
          resulting: currentScore,
          delta: 0,
          isValid: false,
          error: "Maximum 2 decimal places allowed",
        };
      }

      if (op === "DIVIDE" && val === 0) {
        return { resulting: currentScore, delta: 0, isValid: false, error: "Division by zero" };
      }

      let resulting = currentScore;
      let delta = 0;

      switch (op) {
        case "ADD":
          resulting = currentScore + val;
          delta = val;
          break;
        case "SUBTRACT":
          resulting = currentScore - val;
          delta = -val;
          break;
        case "MULTIPLY":
          resulting = Math.round(currentScore * val * 100) / 100;
          delta = resulting - currentScore;
          break;
        case "DIVIDE":
          resulting = Math.round((currentScore / val) * 100) / 100;
          delta = resulting - currentScore;
          break;
        case "SET_SCORE":
          resulting = val;
          delta = val - currentScore;
          break;
      }

      if (!allowNegativeScores && resulting < 0) {
        return {
          resulting,
          delta,
          isValid: false,
          error: "Negative scores are disabled",
        };
      }

      return { resulting, delta, isValid: true, error: null };
    },
    [allowNegativeScores]
  );

  // Staged operations ready to commit
  const stagedItems = useMemo(() => {
    const items: {
      team: Team;
      op: Operation;
      inputVal: number;
      prevScore: number;
      resScore: number;
      delta: number;
      reason?: string;
    }[] = [];

    initialTeams.forEach((team) => {
      const state = rowStates[team.id];
      if (state && state.staged && state.inputValue.trim() !== "") {
        const curScore = teamScores[team.id] ?? 10000;
        const math = calculateProvisional(curScore, state.operation, state.inputValue);
        if (math.isValid && !math.error) {
          items.push({
            team,
            op: state.operation,
            inputVal: parseFloat(state.inputValue),
            prevScore: curScore,
            resScore: math.resulting,
            delta: math.delta,
            reason: state.reason || undefined,
          });
        }
      }
    });

    return items;
  }, [calculateProvisional, initialTeams, rowStates, teamScores]);

  // Submit batch handler
  const handleCommitBatch = async () => {
    if (!selectedRoundId) {
      setActionError("Please select a target round.");
      return;
    }

    if (stagedItems.length === 0) {
      setActionError("No valid operations are currently staged in the batch.");
      return;
    }

    // Verify no staged item exceeds 2 decimal places
    for (const item of stagedItems) {
      if (/\.[0-9]{3,}$/.test(String(item.inputVal))) {
        setActionError(`Team "${item.team.name}" input value exceeds maximum allowed decimal precision of 2 decimal places.`);
        return;
      }
    }

    setLoading(true);
    setActionError(null);

    // Persist pending submission with 'submitting' status prior to dispatching network call
    try {
      const pendingRecord: PendingScoreBatch = {
        idempotencyKey: batchIdempotencyKey,
        roundId: selectedRoundId,
        batchReason,
        rowStates,
        timestamp: Date.now(),
        status: "submitting",
      };
      localStorage.setItem(PENDING_BATCH_STORAGE_KEY, JSON.stringify(pendingRecord));
    } catch {}

    const operationsPayload: ScoreOperationInput[] = stagedItems.map((item) => ({
      team_id: item.team.id,
      operation_type: item.op,
      input_value: item.inputVal,
      reason: item.reason || batchReason,
    }));

    const res = await recordScoreBatchAction({
      roundId: selectedRoundId,
      operations: operationsPayload,
      reason: batchReason,
      idempotencyKey: batchIdempotencyKey,
    });

    setLoading(false);

    if (!res.success) {
      setActionError(res.error || "Failed to commit score batch to database.");
      // Persist failure: retains batchIdempotencyKey so subsequent retry reuses the exact same key and payload
      try {
        const failRecord: PendingScoreBatch = {
          idempotencyKey: batchIdempotencyKey,
          roundId: selectedRoundId,
          batchReason,
          rowStates,
          timestamp: Date.now(),
          status: "failed",
        };
        localStorage.setItem(PENDING_BATCH_STORAGE_KEY, JSON.stringify(failRecord));
      } catch {}
    } else {
      // Server confirmed success: remove pending batch from storage
      try {
        localStorage.removeItem(PENDING_BATCH_STORAGE_KEY);
      } catch {}

      // Regenerate fresh unique idempotency key for the next new batch
      setBatchIdempotencyKey(crypto.randomUUID());
      setRestoredNotice(null);

      // Authoritatively update local team scores
      const nextScores = { ...teamScores };
      const rpcPayload = res.data as { updated_scores?: Record<string, number> } | undefined;
      if (rpcPayload?.updated_scores) {
        Object.entries(rpcPayload.updated_scores).forEach(([teamId, newScore]) => {
          nextScores[teamId] = Number(newScore);
        });
      } else {
        stagedItems.forEach((item) => {
          nextScores[item.team.id] = item.resScore;
        });
      }
      setTeamScores(nextScores);

      // Reset row inputs
      setRowStates((prev) => {
        const next = { ...prev };
        stagedItems.forEach((item) => {
          next[item.team.id] = {
            operation: "ADD",
            inputValue: "",
            reason: "",
            staged: false,
          };
        });
        return next;
      });

      setActionSuccess(
        `Successfully committed ${stagedItems.length} score transactions to the immutable ledger.`
      );
      setTimeout(() => setActionSuccess(null), 6000);
    }
  };

  const selectedRound = initialRounds.find((r) => r.id === selectedRoundId);

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {restoredNotice && (
        <div className="p-4 rounded-xl border border-gold/40 bg-gold/10 text-gold flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <Shield className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gold">Unconfirmed Batch Recovered</p>
              <p className="mt-0.5 text-foreground/80 leading-relaxed">{restoredNotice}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              size="sm"
              onClick={handleCommitBatch}
              disabled={loading || stagedItems.length === 0}
              className="bg-gold text-charcoal hover:bg-gold-bright font-bold text-xs h-8 px-3 gap-1"
            >
              <Send className="w-3 h-3" />
              Retry Batch
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAbandonBatch}
              disabled={loading}
              className="border-border text-xs h-8 px-3 hover:bg-destructive/10 hover:text-casino-red"
            >
              Abandon Batch
            </Button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="p-4 rounded-xl border border-casino-red/40 bg-casino-red/10 text-casino-red flex items-start justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Backend Scoring Failure Notice</p>
              <p className="mt-0.5 opacity-90 leading-relaxed">{actionError}</p>
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
            <span className="font-semibold">{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Round Selector Header */}
      <div className="p-4 rounded-xl border border-border bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center text-gold">
            <Crosshair className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Select Scoring Round
            </h2>
            <select
              value={selectedRoundId}
              onChange={(e) => handleRoundChange(e.target.value)}
              className="mt-1 px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm font-semibold focus:outline-none focus:border-gold"
            >
              {initialRounds.length === 0 ? (
                <option value="">No rounds available — create a round first</option>
              ) : (
                initialRounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    Round {r.round_number}: {r.name} ({r.status.toUpperCase()})
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {selectedRound && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">Status:</span>
            <Badge
              className={cn(
                "text-[10px] uppercase tracking-wider",
                selectedRound.status === "active"
                  ? "bg-emerald/15 text-emerald border-emerald/20"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {selectedRound.status}
            </Badge>
          </div>
        )}
      </div>

      {/* Main Scoring Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Registered Teams Table with In-Row Math */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Registered Teams Scoring Floor ({initialTeams.length} Teams)
            </h3>
            <span className="text-[11px] text-muted-foreground font-mono">
              Supports ADD, SUBTRACT, MULTIPLY, DIVIDE & SET
            </span>
          </div>

          {initialTeams.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center space-y-2">
              <Shield className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
              <h4 className="text-sm font-semibold text-foreground">No Teams Registered</h4>
              <p className="text-xs text-muted-foreground">
                Please enroll participating teams in the Teams manager before recording scores.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {initialTeams.map((team) => {
                const state = rowStates[team.id] || {
                  operation: "ADD",
                  inputValue: "",
                  reason: "",
                  staged: false,
                };
                const curScore = teamScores[team.id] ?? 10000;
                const math = calculateProvisional(curScore, state.operation, state.inputValue);

                return (
                  <div
                    key={team.id}
                    className={cn(
                      "p-4 rounded-xl border transition-all space-y-3 art-deco-corner",
                      state.staged
                        ? "border-gold/50 bg-gold/5 shadow-md"
                        : "border-border bg-card hover:border-gold/30"
                    )}
                  >
                    {/* Top line: Team identity & Current Score */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-sm"
                          style={{ backgroundColor: team.color || "#d4a843" }}
                        >
                          {team.name.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="font-bold text-sm text-foreground truncate font-serif">
                          {team.name}
                        </span>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs text-muted-foreground mr-1">Current Overall:</span>
                        <span className="text-sm font-bold font-mono text-foreground tabular-nums">
                          {curScore.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Middle line: Operation Selector, Value Input, Stage Button */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                      {/* Operation Selector */}
                      <div className="sm:col-span-4 flex items-center gap-1 bg-background p-1 rounded-lg border border-border">
                        {(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "SET_SCORE"] as Operation[]).map((op) => (
                          <button
                            key={op}
                            type="button"
                            onClick={() => updateRow(team.id, { operation: op })}
                            className={cn(
                              "flex-1 py-1 rounded text-[11px] font-bold transition-all text-center",
                              state.operation === op
                                ? "bg-gold text-charcoal shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            title={op}
                          >
                            {op === "ADD" && "+"}
                            {op === "SUBTRACT" && "-"}
                            {op === "MULTIPLY" && "×"}
                            {op === "DIVIDE" && "÷"}
                            {op === "SET_SCORE" && "="}
                          </button>
                        ))}
                      </div>

                      {/* Number Input */}
                      <div className="sm:col-span-5">
                        <input
                          type="number"
                          step="any"
                          placeholder="Points (e.g. 500 or -250)"
                          value={state.inputValue}
                          onChange={(e) =>
                            updateRow(team.id, {
                              inputValue: e.target.value,
                              staged: e.target.value.trim() !== "",
                            })
                          }
                          className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm font-mono font-semibold focus:outline-none focus:border-gold"
                        />
                      </div>

                      {/* Stage/Unstage Toggle */}
                      <div className="sm:col-span-3 flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant={state.staged ? "default" : "outline"}
                          disabled={!math.isValid || Boolean(math.error)}
                          onClick={() => updateRow(team.id, { staged: !state.staged })}
                          className={cn(
                            "w-full text-xs h-8 font-semibold",
                            state.staged
                              ? "bg-gold text-charcoal hover:bg-gold-bright"
                              : "border-border text-foreground hover:bg-muted"
                          )}
                        >
                          {state.staged ? "Staged ✓" : "Stage Row"}
                        </Button>
                      </div>
                    </div>

                    {/* Bottom line: Realtime Mathematical Verification */}
                    {state.inputValue.trim() !== "" && (
                      <div className="pt-2 border-t border-border flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-1.5">
                          {math.error ? (
                            <span className="text-casino-red font-semibold">{math.error}</span>
                          ) : (
                            <>
                              <span className="text-muted-foreground">{curScore}</span>
                              <span className="text-muted-foreground">→</span>
                              <span
                                className={cn(
                                  "font-bold",
                                  math.delta > 0
                                    ? "text-emerald"
                                    : math.delta < 0
                                    ? "text-casino-red"
                                    : "text-muted-foreground"
                                )}
                              >
                                {math.delta > 0 ? `+${math.delta}` : math.delta}
                              </span>
                              <span className="text-muted-foreground">=</span>
                              <span className="font-bold text-gold text-sm">
                                {math.resulting.toLocaleString()}
                              </span>
                              <span className="text-[10px] text-muted-foreground font-sans ml-1">
                                (Projected Overall)
                              </span>
                            </>
                          )}
                        </div>

                        <input
                          type="text"
                          placeholder="Audit reason (optional)..."
                          value={state.reason}
                          onChange={(e) => updateRow(team.id, { reason: e.target.value })}
                          className="px-2 py-0.5 rounded border border-border/80 bg-background/50 text-[11px] text-foreground focus:outline-none focus:border-gold w-44 truncate"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Col: Batch Review & Atomic Commit Station */}
        <div className="space-y-6">
          <div className="rounded-xl border border-gold/40 bg-card p-5 space-y-5 art-deco-corner shadow-xl">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                Atomic Batch Review Station
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {stagedItems.length} operations staged for round submission
              </p>
            </div>

            {/* Staged Items List */}
            {stagedItems.length === 0 ? (
              <div className="p-6 rounded-lg border border-dashed border-border/80 text-center text-xs text-muted-foreground space-y-1">
                <p>No operations staged yet.</p>
                <p className="text-[10px]">
                  Enter points on any team row to automatically stage it in this batch.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto admin-scroll pr-1">
                {stagedItems.map((item) => (
                  <div
                    key={item.team.id}
                    className="p-2.5 rounded-lg border border-border bg-background/70 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-foreground truncate">{item.team.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {item.op} {item.inputVal} (Delta:{" "}
                        {item.delta > 0 ? `+${item.delta}` : item.delta})
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-gold text-xs">
                        {item.resScore.toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateRow(item.team.id, { staged: false, inputValue: "" })}
                        className="text-muted-foreground hover:text-casino-red p-1 rounded"
                        title="Remove from batch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Batch Reason Input */}
            <div className="space-y-1.5 pt-2 border-t border-border">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Batch Ledger Audit Reason
              </label>
              <input
                type="text"
                required
                value={batchReason}
                onChange={(e) => handleReasonChange(e.target.value)}
                placeholder="e.g. Round 2 High-Roller Settlement"
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:border-gold"
              />
            </div>

            {/* Commit & Abandon Controls */}
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={loading || stagedItems.length === 0}
                onClick={handleCommitBatch}
                className="flex-1 h-11 bg-gold text-charcoal hover:bg-gold-bright font-bold tracking-wider uppercase text-xs shadow-lg shadow-gold/20 gap-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Recording in Ledger...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Commit Batch Atomically ({stagedItems.length})
                  </>
                )}
              </Button>
              {stagedItems.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading}
                  onClick={handleAbandonBatch}
                  className="h-11 px-3 border-border hover:border-casino-red/50 hover:bg-casino-red/10 hover:text-casino-red text-xs"
                  title="Abandon this batch and discard staged values"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
