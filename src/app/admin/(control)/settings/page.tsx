import { Database, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getAdminDashboardData } from "@/lib/data";
import { SettingsForm } from "@/components/admin/settings-form";

export default async function SettingsPage() {
  const { activeEvent, settings, dbStatus } = await getAdminDashboardData();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-gold font-serif text-lg">♠</span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-serif uppercase">
            Tournament Floor Configuration
          </h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Manage event-wide parameters, leaderboard freezing protocol, public projection visibility, and PostgreSQL database status.
        </p>
      </div>

      {/* Database Schema Status Box */}
      <div className="rounded-xl border border-gold/40 bg-card p-6 space-y-4 art-deco-corner shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-gold/15 text-gold">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground font-serif uppercase">
                Supabase PostgreSQL Schema Status
              </h3>
              <p className="text-xs text-muted-foreground">
                Database table availability and RLS security enforcement verification
              </p>
            </div>
          </div>
          <Badge
            className={
              dbStatus.isConnected && dbStatus.missingTables.length === 0
                ? "bg-emerald/15 text-emerald border-emerald/20 text-xs"
                : "bg-gold/15 text-gold border-gold/20 text-xs"
            }
          >
            {dbStatus.missingTables.length === 0 ? "Schema Fully Migrated" : "Migration Pending"}
          </Badge>
        </div>

        <div className="pt-2 border-t border-border space-y-2.5 text-xs">
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground">Pending Migration File:</span>
            <span className="font-mono text-gold text-[11px] font-semibold">
              supabase/migrations/20261116000000_casino_royale_complete.sql
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground">Missing Tables Status:</span>
            <span className="font-mono text-gold">
              {dbStatus.missingTables.length > 0
                ? dbStatus.missingTables.join(", ")
                : "All core tables detected"}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground">Row Level Security (RLS):</span>
            <span className="font-semibold text-emerald flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Strict Authoritative Isolation
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Authoritative Math:</span>
            <span className="font-mono text-foreground">PostgreSQL NUMERIC(12, 2)</span>
          </div>
        </div>
      </div>

      {/* Settings Form Client Component */}
      <SettingsForm
        initialEvent={activeEvent}
        initialSettings={settings}
      />
    </div>
  );
}
