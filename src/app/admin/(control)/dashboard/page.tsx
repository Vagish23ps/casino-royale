import Link from "next/link";
import {
  Users,
  CircleDot,
  Crosshair,
  TrendingUp,
  Eye,
  ShieldCheck,
  ChevronRight,
  Database,
  RefreshCw,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/admin/stat-card";
import { LeaderCard } from "@/components/admin/leader-card";
import { RoundOverview } from "@/components/admin/round-overview";
import { RecentActivity } from "@/components/admin/recent-activity";
import { LeaderboardPreview } from "@/components/admin/leaderboard-preview";
import { EmptyState } from "@/components/admin/empty-state";
import { getAdminDashboardData } from "@/lib/data";

export default async function AdminDashboardPage() {
  const data = await getAdminDashboardData();
  const {
    activeEvent,
    settings,
    rounds,
    activeRound,
    recentTransactions,
    leaderboard,
    stats,
    dbStatus,
  } = data;

  const topLeader = leaderboard.length > 0 ? leaderboard[0] : null;

  return (
    <div className="space-y-6">
      {/* DB Status Diagnostic Alert if schema tables are pending */}
      {(!dbStatus.isConnected || dbStatus.missingTables.length > 0) && (
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 art-deco-corner shadow-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-gold/15 text-gold shrink-0 mt-0.5">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <span>PostgreSQL Migration Required</span>
                <Badge className="bg-gold/20 text-gold border-gold/30 text-[10px] uppercase font-mono">
                  Schema Unapplied
                </Badge>
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">
                {dbStatus.missingTables.length > 0 ? (
                  <>
                    The following tables are pending execution in Supabase:{" "}
                    <span className="font-mono text-gold font-semibold">
                      {dbStatus.missingTables.join(", ")}
                    </span>
                    . Review the generated migration file at{" "}
                    <span className="font-mono text-xs text-foreground bg-muted px-1 py-0.5 rounded">
                      supabase/migrations/20261116000000_casino_royale_complete.sql
                    </span>
                    .
                  </>
                ) : (
                  <>Supabase connection status: {dbStatus.error || "Awaiting database configuration"}</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Compact Event Control Header Bar */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="text-gold font-serif text-sm">♠</span>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-serif uppercase">
              {activeEvent?.name || "Casino Royale Gala Floor"}
            </h1>
            <Badge
              className={
                activeEvent?.status === "active"
                  ? "bg-emerald/15 text-emerald border-emerald/20 text-[10px] uppercase"
                  : "bg-gold/15 text-gold border-gold/20 text-[10px] uppercase"
              }
            >
              {activeEvent ? activeEvent.status : "Draft"}
            </Badge>
            {settings?.leaderboard_frozen && (
              <Badge className="bg-casino-red/15 text-casino-red border-casino-red/20 text-[10px] uppercase">
                Frozen
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {activeRound
              ? `Currently Active: Round ${activeRound.round_number} — ${activeRound.name}`
              : "No round active currently. Select or activate a round to begin scoring."}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link href="/admin/score-control">
            <Button size="sm" className="bg-gold text-charcoal hover:bg-gold-bright font-bold text-xs gap-1.5">
              <Crosshair className="w-3.5 h-3.5" />
              Score Control
            </Button>
          </Link>
          <Link href="/admin/live-display" target="_blank">
            <Button variant="outline" size="sm" className="border-border text-foreground text-xs gap-1.5">
              <Eye className="w-3.5 h-3.5 text-gold" />
              Launch Live Scoreboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Compact KPI Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          title="Active Teams"
          value={stats.totalTeams}
          subtitle={stats.totalTeams === 0 ? "No teams registered" : "Enrolled syndicates"}
          icon={Users}
          iconColor="text-gold"
        />
        <StatCard
          title="Active Round"
          value={activeRound ? `Round ${activeRound.round_number}` : stats.totalRounds > 0 ? "None active" : "0 created"}
          subtitle={activeRound ? activeRound.name : "Awaiting activation"}
          icon={CircleDot}
          iconColor={activeRound ? "text-emerald" : "text-muted-foreground"}
        />
        <StatCard
          title="Score Operations"
          value={stats.totalTransactions}
          subtitle="Audit-logged transactions"
          icon={TrendingUp}
          iconColor="text-gold-bright"
        />
        <StatCard
          title="Leaderboard Feed"
          value={settings?.leaderboard_frozen ? "Frozen" : "Live Realtime"}
          subtitle={settings?.leaderboard_frozen ? "Freeze snapshot active" : "Streaming live score changes"}
          icon={ShieldCheck}
          iconColor={settings?.leaderboard_frozen ? "text-casino-red" : "text-emerald"}
        />
      </div>

      {/* Main 2-Column Floor Control Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Leaderboard Standings & Quick Operations */}
        <div className="lg:col-span-2 space-y-6">
          {/* Top Leader Card if any */}
          {topLeader && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tournament Pacesetter
                </span>
                <Link
                  href="/admin/teams"
                  className="text-xs text-gold hover:text-gold-bright flex items-center gap-1 font-medium"
                >
                  View all teams <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              <LeaderCard
                rank={topLeader.rank}
                teamName={topLeader.team_name}
                score={topLeader.total_score}
                teamColor={topLeader.team_color}
              />
            </div>
          )}

          {/* Standings Overview */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  Tournament Standings
                </h3>
                <p className="text-xs text-muted-foreground">
                  Current overall chip counts from verified ledger
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/admin/teams">
                  <Button variant="ghost" size="sm" className="text-xs text-gold h-7 px-2">
                    Manage Teams
                  </Button>
                </Link>
              </div>
            </div>

            {leaderboard.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No Teams Enrolled"
                description="Begin by enrolling participating teams or VIP syndicates in the Teams manager."
                action={
                  <Link href="/admin/teams">
                    <Button size="sm" className="bg-gold text-charcoal hover:bg-gold-bright font-semibold text-xs gap-1.5">
                      <Plus className="w-3.5 h-3.5" />
                      Enroll First Team
                    </Button>
                  </Link>
                }
              />
            ) : (
              <LeaderboardPreview entries={leaderboard} maxEntries={5} />
            )}
          </div>

          {/* Quick Actions Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/admin/score-control"
              className="p-3.5 rounded-xl border border-border bg-card hover:border-gold/40 hover:bg-muted/40 transition-all flex flex-col items-center text-center gap-1.5"
            >
              <div className="p-2 rounded-lg bg-gold/10 text-gold">
                <Crosshair className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">Score Batch</span>
            </Link>

            <Link
              href="/admin/rounds"
              className="p-3.5 rounded-xl border border-border bg-card hover:border-gold/40 hover:bg-muted/40 transition-all flex flex-col items-center text-center gap-1.5"
            >
              <div className="p-2 rounded-lg bg-emerald/10 text-emerald">
                <CircleDot className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">Manage Rounds</span>
            </Link>

            <Link
              href="/admin/history"
              className="p-3.5 rounded-xl border border-border bg-card hover:border-gold/40 hover:bg-muted/40 transition-all flex flex-col items-center text-center gap-1.5"
            >
              <div className="p-2 rounded-lg bg-sky-400/10 text-sky-400">
                <RefreshCw className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">Audit Ledger</span>
            </Link>
          </div>
        </div>

        {/* Right 1 Col: Rounds Status & Recent Transactions */}
        <div className="space-y-6">
          {/* Rounds Overview */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                Rounds Tracker
              </h3>
              <Link href="/admin/rounds">
                <Button variant="ghost" size="sm" className="text-xs text-gold h-7 px-2">
                  All Rounds
                </Button>
              </Link>
            </div>

            {rounds.length === 0 ? (
              <EmptyState
                icon={CircleDot}
                title="No Rounds Created"
                description="Create tournament rounds (Baccarat, Roulette, Blackjack) to structure your scoring."
                action={
                  <Link href="/admin/rounds">
                    <Button size="sm" variant="outline" className="text-xs border-gold/40 text-gold">
                      Create Round
                    </Button>
                  </Link>
                }
              />
            ) : (
              <RoundOverview rounds={rounds} />
            )}
          </div>

          {/* Recent Live Operations Feed */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                Live Score Log
              </h3>
              <Link href="/admin/history">
                <Button variant="ghost" size="sm" className="text-xs text-gold h-7 px-2">
                  Full Log
                </Button>
              </Link>
            </div>

            {recentTransactions.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No Transactions Yet"
                description="Recorded score updates will appear here in chronological order."
              />
            ) : (
              <RecentActivity transactions={recentTransactions.slice(0, 5)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
