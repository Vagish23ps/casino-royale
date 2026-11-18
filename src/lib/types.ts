// Database types for the Casino Royale application.
// These represent the expected schema. Tables may not exist yet if migrations
// haven't been run — components should handle missing data gracefully.

export type AdminProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: "owner" | "organizer" | "scorer";
  created_at: string;
  updated_at: string;
};

export type Event = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type EventAdmin = {
  event_id: string;
  admin_id: string;
  role: "owner" | "organizer";
  created_at: string;
};

export type EventSettings = {
  event_id: string;
  leaderboard_visible: boolean;
  leaderboard_frozen: boolean;
  frozen_at: string | null;
  starting_score: number;
  sort_direction: "desc" | "asc";
  updated_at: string;
};

export type Team = {
  id: string;
  event_id: string;
  name: string;
  color: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Round = {
  id: string;
  event_id: string;
  name: string;
  round_number: number;
  status: "upcoming" | "active" | "completed";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ScoreTransaction = {
  id: string;
  event_id: string;
  team_id: string;
  round_id: string | null;
  operation_type: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "SET_SCORE";
  input_value: number;
  previous_score: number;
  resulting_score: number;
  points_delta: number;
  reason: string | null;
  idempotency_key: string | null;
  reversal_of_transaction_id: string | null;
  created_by: string;
  created_at: string;
};

// View types
export type LeaderboardEntry = {
  team_id: string;
  team_name: string;
  team_color: string | null;
  avatar_url?: string | null;
  total_score: number;
  rank: number;
};

export type TeamRoundScore = {
  round_id: string;
  round_name: string;
  round_number: number;
  points_delta: number;
  transactions_count: number;
  earned_points?: number;
  adjustment_points?: number;
  reversal_points?: number;
  has_score_reset?: boolean;
  has_reversal?: boolean;
};

export type ScoreOperationInput = {
  team_id: string;
  operation_type: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "SET_SCORE";
  input_value: number;
  reason?: string;
};

// Dashboard summary types
export type DashboardStats = {
  totalEvents: number;
  activeEvents: number;
  totalTeams: number;
  totalRounds: number;
  activeRounds: number;
  totalTransactions: number;
};
