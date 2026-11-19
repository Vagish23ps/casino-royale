"use client";

import { useState } from "react";
import { Snowflake, Eye, EyeOff, Save, Check, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateEventSettingsAction } from "@/lib/actions";
import type { Event, EventSettings } from "@/lib/types";

type SettingsFormProps = {
  initialEvent: Event | null;
  initialSettings: EventSettings | null;
};

export function SettingsForm({ initialEvent, initialSettings }: SettingsFormProps) {
  const [frozen, setFrozen] = useState(Boolean(initialSettings?.leaderboard_frozen));
  const [visible, setVisible] = useState(initialSettings?.leaderboard_visible !== false);
  const [startingScore, setStartingScore] = useState(
    initialSettings?.starting_score !== undefined && initialSettings?.starting_score !== null
      ? String(initialSettings.starting_score)
      : "0"
  );
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">(
    initialSettings?.sort_direction || "desc"
  );

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const parsedStarting = parseFloat(startingScore);
    if (!isNaN(parsedStarting) && parsedStarting < 0) {
      setLoading(false);
      setErrorMsg("Starting chip allocation must be non-negative (≥ 0).");
      return;
    }

    const res = await updateEventSettingsAction({
      leaderboard_frozen: frozen,
      leaderboard_visible: visible,
      starting_score: isNaN(parsedStarting) ? 0 : parsedStarting,
      sort_direction: sortDirection,
    });

    setLoading(false);

    if (!res.success) {
      setErrorMsg(res.error || "Failed to update event settings");
    } else {
      setSuccessMsg("Event parameters and broadcast rules successfully updated.");
      setTimeout(() => setSuccessMsg(null), 5000);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {initialEvent && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pb-2 border-b border-border/50">
          <span>Active Tournament: <strong className="text-foreground">{initialEvent.name}</strong></span>
          <span className="font-mono text-[10px] opacity-75">{initialEvent.id}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl border border-casino-red/40 bg-casino-red/10 text-casino-red flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-casino-red hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl border border-emerald/40 bg-emerald/10 text-emerald flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-emerald hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Broadcast & Freezing Rules */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground font-serif">
          Broadcast & Freeze Protocol
        </h3>

        <div className="space-y-4">
          {/* Freeze toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-background/50">
            <div className="space-y-0.5">
              <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Snowflake className="w-4 h-4 text-sky-400" />
                Freeze Public Leaderboard Standings
              </span>
              <p className="text-xs text-muted-foreground">
                Prevents live standings from recalculating on spectator displays while allowing organizers to continue recording scores in the background.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFrozen(!frozen)}
              className={
                frozen
                  ? "bg-casino-red/15 border-casino-red/40 text-casino-red text-xs font-bold"
                  : "border-border text-foreground text-xs"
              }
            >
              {frozen ? "Frozen (Click to Unfreeze)" : "Active Stream (Click to Freeze)"}
            </Button>
          </div>

          {/* Visibility toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-background/50">
            <div className="space-y-0.5">
              <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                {visible ? <Eye className="w-4 h-4 text-emerald" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                Public Projector Display Feed
              </span>
              <p className="text-xs text-muted-foreground">
                Control whether the public scoreboard URL (/public-view) broadcasts ranks or shows a blackout screen.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVisible(!visible)}
              className={
                visible
                  ? "bg-emerald/15 border-emerald/40 text-emerald text-xs font-bold"
                  : "border-border text-muted-foreground text-xs"
              }
            >
              {visible ? "Broadcasting Live" : "Feed Hidden"}
            </Button>
          </div>

          {/* Numbers & Direction */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Starting Chip Allocation Per Team
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={startingScore}
                onChange={(e) => setStartingScore(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-mono font-semibold focus:outline-none focus:border-gold"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ranking Priority Direction
              </label>
              <select
                value={sortDirection}
                onChange={(e) => setSortDirection(e.target.value as "desc" | "asc")}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-semibold focus:outline-none focus:border-gold"
              >
                <option value="desc">Highest Score Wins (Standard Casino Gala)</option>
                <option value="asc">Lowest Score Wins (Penalty Golf)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-border flex justify-end">
          <Button
            type="submit"
            disabled={loading}
            className="bg-gold text-charcoal hover:bg-gold-bright font-bold text-xs h-10 px-5 gap-2 uppercase tracking-wider shadow-lg shadow-gold/15"
          >
            <Save className="w-3.5 h-3.5" />
            {loading ? "Saving Parameters..." : "Save Configuration"}
          </Button>
        </div>
      </div>
    </form>
  );
}
