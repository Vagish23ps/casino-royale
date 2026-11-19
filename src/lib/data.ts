import { createClient } from "@/lib/supabase/server";
import type {
  Event,
  EventSettings,
  Team,
  Round,
  ScoreTransaction,
  LeaderboardEntry,
  TeamRoundScore,
  DashboardStats,
} from "@/lib/types";

export type AdminDashboardData = {
  activeEvent: Event | null;
  settings: EventSettings | null;
  teams: Team[];
  rounds: Round[];
  activeRound: Round | null;
  recentTransactions: (ScoreTransaction & { team_name?: string; round_name?: string })[];
  leaderboard: LeaderboardEntry[];
  stats: DashboardStats;
  dbStatus: {
    isConnected: boolean;
    missingTables: string[];
    error: string | null;
  };
};

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const missingTables: string[] = [];
  let isConnected = true;
  let connectionError: string | null = null;

  let activeEvent: Event | null = null;
  let settings: EventSettings | null = null;
  let teams: Team[] = [];
  let rounds: Round[] = [];
  let recentTransactions: (ScoreTransaction & { team_name?: string; round_name?: string })[] = [];
  let leaderboard: LeaderboardEntry[] = [];

  try {
    const supabase = await createClient();

    // 1. Fetch active event
    try {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("does not exist")) {
          missingTables.push("events");
        } else {
          connectionError = error.message;
        }
      } else if (data) {
        activeEvent = data as Event;
      } else {
        const { data: latestEvent } = await supabase
          .from("events")
          .select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestEvent) {
          activeEvent = latestEvent as Event;
        }
      }
    } catch (e: unknown) {
      connectionError = e instanceof Error ? e.message : "Failed to query events table";
    }

    const eventId = activeEvent?.id;

    // 2. Fetch event settings
    if (eventId) {
      try {
        const { data, error } = await supabase
          .from("event_settings")
          .select("*")
          .eq("event_id", eventId)
          .maybeSingle();

        if (error && (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("does not exist"))) {
          missingTables.push("event_settings");
        } else if (data) {
          settings = data as EventSettings;
        }
      } catch {
        // Handled gracefully
      }
    }

    // 3. Fetch active teams
    try {
      let query = supabase.from("teams").select("*").is("deleted_at", null);
      if (eventId) {
        query = query.eq("event_id", eventId);
      }
      const { data, error } = await query.order("created_at", { ascending: true });

      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("does not exist")) {
          missingTables.push("teams");
        }
      } else if (data) {
        teams = data as Team[];
      }
    } catch {
      // Handled gracefully
    }

    // 4. Fetch rounds
    try {
      let query = supabase.from("rounds").select("*").is("deleted_at", null);
      if (eventId) {
        query = query.eq("event_id", eventId);
      }
      const { data, error } = await query.order("round_number", { ascending: true });

      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("does not exist")) {
          missingTables.push("rounds");
        }
      } else if (data) {
        rounds = data as Round[];
      }
    } catch {
      // Handled gracefully
    }

    // 5. Fetch score transactions
    try {
      let query = supabase.from("score_transactions").select("*");
      if (eventId) {
        query = query.eq("event_id", eventId);
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("does not exist")) {
          missingTables.push("score_transactions");
        }
      } else if (data) {
        const teamMap = new Map<string, string>();
        teams.forEach((t) => teamMap.set(t.id, t.name));

        const roundMap = new Map<string, string>();
        rounds.forEach((r) => roundMap.set(r.id, r.name));

        recentTransactions = (data as ScoreTransaction[]).map((tx) => ({
          ...tx,
          team_name: teamMap.get(tx.team_id) || "Unknown Team",
          round_name: tx.round_id ? roundMap.get(tx.round_id) || `Round` : undefined,
        }));
      }
    } catch {
      // Handled gracefully
    }

    // 6. Fetch Leaderboard (first try view, fallback to aggregation)
    try {
      let query = supabase.from("v_public_overall_leaderboard").select("*");
      if (eventId) {
        query = query.eq("event_id", eventId);
      }
      const { data, error } = await query.order("rank", { ascending: true });

      if (!error && data && data.length > 0) {
        leaderboard = (data as Record<string, unknown>[]).map((d) => ({
          team_id: String(d.team_id || ""),
          team_name: String(d.team_name || ""),
          team_color: typeof d.team_color === "string" ? d.team_color : null,
          avatar_url: typeof d.avatar_url === "string" ? d.avatar_url : null,
          total_score: Number(d.total_score || 0),
          rank: Number(d.rank || 1),
        }));
      } else if (teams.length > 0) {
        // Fallback: derive leaderboard from actual teams and transactions in DB
        const startingScore = Number(settings?.starting_score || 0.0);
        const scoreMap = new Map<string, number>();
        teams.forEach((t) => scoreMap.set(t.id, startingScore));

        // Get all transactions for teams (scoped to active event)
        let txQuery = supabase
          .from("score_transactions")
          .select("team_id, points_delta");
        if (eventId) {
          txQuery = txQuery.eq("event_id", eventId);
        }
        const { data: allTxs } = await txQuery;

        if (allTxs) {
          allTxs.forEach((tx: { team_id: string; points_delta: number | null }) => {
            const current = scoreMap.get(tx.team_id) ?? startingScore;
            scoreMap.set(tx.team_id, current + Number(tx.points_delta || 0));
          });
        }

        const sorted = teams
          .map((team) => ({
            team_id: team.id,
            team_name: team.name,
            team_color: team.color,
            avatar_url: team.avatar_url,
            total_score: scoreMap.get(team.id) || startingScore,
            rank: 1,
          }))
          .sort((a, b) => b.total_score - a.total_score);

        leaderboard = sorted.map((item, idx) => ({
          ...item,
          rank: idx + 1,
        }));
      }
    } catch {
      // Handled gracefully
    }
  } catch (err: unknown) {
    isConnected = false;
    connectionError = err instanceof Error ? err.message : "Could not connect to Supabase";
  }

  const activeRound = rounds.find((r) => r.status === "active") || null;

  const stats: DashboardStats = {
    totalEvents: activeEvent ? 1 : 0,
    activeEvents: activeEvent?.status === "active" ? 1 : 0,
    totalTeams: teams.length,
    totalRounds: rounds.length,
    activeRounds: rounds.filter((r) => r.status === "active").length,
    totalTransactions: recentTransactions.length,
  };

  return {
    activeEvent,
    settings,
    teams,
    rounds,
    activeRound,
    recentTransactions,
    leaderboard,
    stats,
    dbStatus: {
      isConnected: isConnected && !connectionError,
      missingTables: Array.from(new Set(missingTables)),
      error: connectionError,
    },
  };
}

// ----------------------------------------------------------------------
// DATA FETCHERS FOR SPECIFIC ADMIN ROUTES
// ----------------------------------------------------------------------

export async function getTeamsManagementData() {
  const supabase = await createClient();
  let activeTeams: Team[] = [];
  let deletedTeams: Team[] = [];
  const teamScores: Record<string, { total: number; roundScores: TeamRoundScore[] }> = {};
  let errorMsg: string | null = null;

  try {
    const { data: active, error: err1 } = await supabase
      .from("teams")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (err1) errorMsg = err1.message;
    else if (active) activeTeams = active as Team[];

    const { data: deleted, error: err2 } = await supabase
      .from("teams")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    if (!err2 && deleted) deletedTeams = deleted as Team[];

    // Fetch active event & settings for starting_score
    let startingScore = 0.0;
    let eventId: string | null = null;
    try {
      const { data: ev } = await supabase
        .from("events")
        .select("id")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ev?.id) {
        eventId = ev.id;
        const { data: st } = await supabase
          .from("event_settings")
          .select("starting_score")
          .eq("event_id", ev.id)
          .maybeSingle();
        if (st?.starting_score !== undefined && st?.starting_score !== null) {
          startingScore = Number(st.starting_score);
        }
      }
    } catch {
      // Handled gracefully
    }

    // Fetch authoritative leaderboard scores from view
    const leaderboardScores = new Map<string, number>();
    try {
      let lbQuery = supabase.from("v_public_overall_leaderboard").select("team_id, total_score");
      if (eventId) {
        lbQuery = lbQuery.eq("event_id", eventId);
      }
      const { data: lbData } = await lbQuery;
      if (lbData) {
        lbData.forEach((row: { team_id?: string; total_score?: number }) => {
          if (row.team_id) {
            leaderboardScores.set(String(row.team_id), Number(row.total_score || 0));
          }
        });
      }
    } catch {
      // Handled gracefully
    }

    // Fetch rounds to map round scores
    let rQuery = supabase
      .from("rounds")
      .select("id, name, round_number")
      .is("deleted_at", null);
    if (eventId) {
      rQuery = rQuery.eq("event_id", eventId);
    }
    const { data: rounds } = await rQuery.order("round_number", { ascending: true });

    const roundList = rounds || [];

    // Fetch all transactions to compute scores (scoped to active event)
    let txQuery = supabase
      .from("score_transactions")
      .select("team_id, round_id, points_delta, operation_type, reversal_of_transaction_id");
    if (eventId) {
      txQuery = txQuery.eq("event_id", eventId);
    }
    const { data: txs } = await txQuery;

    const allTeams = [...activeTeams, ...deletedTeams];

    allTeams.forEach((t) => {
      const teamTxs = (txs || []).filter((tx) => tx.team_id === t.id);
      const totalDelta = teamTxs.reduce((sum, tx) => sum + Number(tx.points_delta || 0), 0);

      const rScores: TeamRoundScore[] = roundList.map((r) => {
        const rTxs = teamTxs.filter((tx) => tx.round_id === r.id);
        const rDelta = rTxs.reduce((sum, tx) => sum + Number(tx.points_delta || 0), 0);
        const earned = rTxs
          .filter((tx) => tx.operation_type !== "SET_SCORE" && !tx.reversal_of_transaction_id)
          .reduce((sum, tx) => sum + Number(tx.points_delta || 0), 0);
        const adjustments = rTxs
          .filter((tx) => tx.operation_type === "SET_SCORE" && !tx.reversal_of_transaction_id)
          .reduce((sum, tx) => sum + Number(tx.points_delta || 0), 0);
        const reversals = rTxs
          .filter((tx) => Boolean(tx.reversal_of_transaction_id))
          .reduce((sum, tx) => sum + Number(tx.points_delta || 0), 0);
        const hasReset = rTxs.some((tx) => tx.operation_type === "SET_SCORE");
        const hasRev = rTxs.some((tx) => Boolean(tx.reversal_of_transaction_id));
        return {
          round_id: r.id,
          round_name: r.name,
          round_number: r.round_number,
          points_delta: rDelta,
          transactions_count: rTxs.length,
          earned_points: earned,
          adjustment_points: adjustments,
          reversal_points: reversals,
          has_score_reset: hasReset,
          has_reversal: hasRev,
        };
      });

      // Authoritative score from view if available, otherwise starting_score + totalDelta
      const authoritativeScore = leaderboardScores.has(t.id)
        ? (leaderboardScores.get(t.id) ?? startingScore)
        : (startingScore + totalDelta);

      teamScores[t.id] = {
        total: authoritativeScore,
        roundScores: rScores,
      };
    });
  } catch (e: unknown) {
    errorMsg = e instanceof Error ? e.message : "Failed to load teams";
  }

  return { activeTeams, deletedTeams, teamScores, error: errorMsg };
}

export async function getRoundsManagementData() {
  const supabase = await createClient();
  let activeRounds: Round[] = [];
  let deletedRounds: Round[] = [];
  const roundStats: Record<string, { transactionsCount: number; teamsParticipated: number }> = {};
  let errorMsg: string | null = null;

  try {
    const { data: active, error: err1 } = await supabase
      .from("rounds")
      .select("*")
      .is("deleted_at", null)
      .order("round_number", { ascending: true });

    if (err1) errorMsg = err1.message;
    else if (active) activeRounds = active as Round[];

    const { data: deleted, error: err2 } = await supabase
      .from("rounds")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    if (!err2 && deleted) deletedRounds = deleted as Round[];

    // Fetch transactions count per round
    const { data: txs } = await supabase
      .from("score_transactions")
      .select("round_id, team_id");

    if (txs) {
      [...activeRounds, ...deletedRounds].forEach((r) => {
        const matching = txs.filter((t) => t.round_id === r.id);
        const uniqueTeams = new Set(matching.map((t) => t.team_id)).size;
        roundStats[r.id] = {
          transactionsCount: matching.length,
          teamsParticipated: uniqueTeams,
        };
      });
    }
  } catch (e: unknown) {
    errorMsg = e instanceof Error ? e.message : "Failed to load rounds";
  }

  return { activeRounds, deletedRounds, roundStats, error: errorMsg };
}

export async function getScoreControlData() {
  const supabase = await createClient();
  let rounds: Round[] = [];
  let teams: Team[] = [];
  const teamScores: Record<string, number> = {};
  let startingScore = 0.0;
  let allowNegativeScores = false;
  let errorMsg: string | null = null;

  try {
    // 0. Determine active event ID first so all subsequent queries are scoped to it
    const { data: evData } = await supabase
      .from("events")
      .select("id, status")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const eventId: string | null = evData?.id ?? null;

    // 1. Get settings (scoped to active event)
    const { data: settings } = await supabase
      .from("event_settings")
      .select("starting_score, allow_negative_scores")
      .eq("event_id", eventId ?? "")
      .maybeSingle();

    if (settings?.starting_score) {
      startingScore = Number(settings.starting_score);
    }
    if (settings?.allow_negative_scores !== undefined) {
      allowNegativeScores = Boolean(settings.allow_negative_scores);
    }

    // 2. Get active rounds (scoped to active event)
    let rQuery = supabase.from("rounds").select("*").is("deleted_at", null);
    if (eventId) rQuery = rQuery.eq("event_id", eventId);
    const { data: rData, error: rErr } = await rQuery.order("round_number", { ascending: true });

    if (rErr) errorMsg = rErr.message;
    else if (rData) rounds = rData as Round[];

    // 3. Get active teams (scoped to active event)
    let tQuery = supabase.from("teams").select("*").is("deleted_at", null);
    if (eventId) tQuery = tQuery.eq("event_id", eventId);
    const { data: tData, error: tErr } = await tQuery.order("name", { ascending: true });

    if (tErr) errorMsg = errorMsg || tErr.message;
    else if (tData) teams = tData as Team[];

    // 4. Calculate current score per team.
    // Query authoritative leaderboard view first, scoped to event_id.
    if (eventId) {
      let viewMatched = false;
      try {
        const { data: viewData, error: viewErr } = await supabase
          .from("v_public_overall_leaderboard")
          .select("team_id, total_score")
          .eq("event_id", eventId);

        if (!viewErr && viewData && viewData.length > 0) {
          const scoreMap = new Map<string, number>();
          viewData.forEach((row: { team_id?: string; total_score?: number }) => {
            if (row.team_id) scoreMap.set(String(row.team_id), Number(row.total_score || 0));
          });
          teams.forEach((t) => {
            teamScores[t.id] = scoreMap.has(t.id) ? (scoreMap.get(t.id) ?? startingScore) : startingScore;
          });
          viewMatched = true;
        }
      } catch {
        // Fallback to score_transactions
      }

      if (!viewMatched) {
        const { data: txs } = await supabase
          .from("score_transactions")
          .select("team_id, points_delta")
          .eq("event_id", eventId);

        teams.forEach((t) => {
          const matching = (txs || []).filter((tx) => tx.team_id === t.id);
          const totalDelta = matching.reduce((sum, tx) => sum + Number(tx.points_delta || 0), 0);
          teamScores[t.id] = startingScore + totalDelta;
        });
      }
    } else {
      teams.forEach((t) => {
        teamScores[t.id] = startingScore;
      });
    }
  } catch (e: unknown) {
    errorMsg = e instanceof Error ? e.message : "Failed to load score control data";
  }

  return { rounds, teams, teamScores, startingScore, allowNegativeScores, error: errorMsg };
}

export async function getHistoryData() {
  const supabase = await createClient();
  let transactions: (ScoreTransaction & { team_name: string; round_name: string })[] = [];
  let teams: Team[] = [];
  let rounds: Round[] = [];
  let errorMsg: string | null = null;

  try {
    const { data: tList } = await supabase.from("teams").select("id, name");
    teams = (tList as Team[]) || [];
    const teamMap = new Map<string, string>();
    teams.forEach((t) => teamMap.set(t.id, t.name));

    const { data: rList } = await supabase.from("rounds").select("id, name, round_number");
    rounds = (rList as Round[]) || [];
    const roundMap = new Map<string, string>();
    rounds.forEach((r) => roundMap.set(r.id, `R${r.round_number}: ${r.name}`));

    const { data: txList, error } = await supabase
      .from("score_transactions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      errorMsg = error.message;
    } else if (txList) {
      transactions = (txList as ScoreTransaction[]).map((tx) => ({
        ...tx,
        team_name: teamMap.get(tx.team_id) || "Unknown Team",
        round_name: tx.round_id ? roundMap.get(tx.round_id) || "Event Level" : "Event Level",
      }));
    }
  } catch (e: unknown) {
    errorMsg = e instanceof Error ? e.message : "Failed to load history";
  }

  return { transactions, teams, rounds, error: errorMsg };
}

export async function getPublicScoreboardData() {
  const supabase = await createClient();
  let event: Event | null = null;
  let settings: EventSettings | null = null;
  let activeRound: Round | null = null;
  let leaderboard: LeaderboardEntry[] = [];
  let errorMsg: string | null = null;

  try {
    const { data: ev } = await supabase
      .from("events")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ev) event = ev as Event;

    if (event?.id) {
      const { data: st } = await supabase
        .from("event_settings")
        .select("*")
        .eq("event_id", event.id)
        .maybeSingle();

      if (st) settings = st as EventSettings;

      const { data: rnd } = await supabase
        .from("rounds")
        .select("*")
        .eq("event_id", event.id)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();

      if (rnd) activeRound = rnd as Round;
    }

    // Try view (scoped to active event to prevent cross-event score drift)
    let viewQuery = supabase
      .from("v_public_overall_leaderboard")
      .select("*");

    if (event?.id) {
      viewQuery = viewQuery.eq("event_id", event.id);
    }

    const { data: viewData, error: viewErr } = await viewQuery.order("rank", { ascending: true });

    if (!viewErr && viewData && viewData.length > 0) {
      leaderboard = (viewData as Record<string, unknown>[]).map((d) => ({
        team_id: String(d.team_id || ""),
        team_name: String(d.team_name || ""),
        team_color: typeof d.team_color === "string" ? d.team_color : null,
        avatar_url: typeof d.avatar_url === "string" ? d.avatar_url : null,
        total_score: Number(d.total_score || 0),
        rank: Number(d.rank || 1),
      }));
    } else {
      // Fallback: load active teams and starting scores without accessing restricted transaction ledger
      let tQuery = supabase
        .from("teams")
        .select("*")
        .is("deleted_at", null);

      if (event?.id) {
        tQuery = tQuery.eq("event_id", event.id);
      }

      const { data: tData } = await tQuery;

      if (tData && tData.length > 0) {
        const startingScore = Number(settings?.starting_score || 0.0);
        leaderboard = (tData as Team[]).map((team, idx) => ({
          team_id: team.id,
          team_name: team.name,
          team_color: team.color,
          avatar_url: team.avatar_url,
          total_score: startingScore,
          rank: idx + 1,
        }));
      }
    }
  } catch (e: unknown) {
    errorMsg = e instanceof Error ? e.message : "Failed to load public scoreboard";
  }

  return { event, settings, activeRound, leaderboard, error: errorMsg };
}
