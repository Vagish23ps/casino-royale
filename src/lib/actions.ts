"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ScoreOperationInput } from "@/lib/types";

// Helper to get authenticated user or throw error
async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Authentication required. Please log in as an authorized organizer.");
  }

  return { supabase, user };
}

// Helper to get or ensure active event ID
export async function getActiveEventId(supabaseClient?: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const supabase = supabaseClient || (await createClient());
  const { data: event } = await supabase
    .from("events")
    .select("id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (event?.id) {
    return event.id;
  }

  // Fallback: try to create a default gala event if none exists
  try {
    const { data: newEvent, error } = await supabase
      .from("events")
      .insert({
        name: "Casino Royale Gala Grand Floor",
        status: "active",
      })
      .select("id")
      .single();

    if (!error && newEvent?.id) {
      // Link current user as owner in event_admins (event_settings is automatically provisioned via database trigger)
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        await supabase.from("event_admins").insert({
          event_id: newEvent.id,
          admin_id: user.id,
          role: "owner",
        });
      }

      return newEvent.id;
    }
  } catch {
    // handled gracefully
  }

  return "00000000-0000-0000-0000-000000000001";
}

// ----------------------------------------------------------------------
// TEAM ACTIONS
// ----------------------------------------------------------------------

export async function createTeamAction(data: {
  name: string;
  color?: string;
  avatar_url?: string;
}) {
  try {
    const { supabase } = await getAuthenticatedUser();
    const eventId = await getActiveEventId(supabase);

    const { data: team, error } = await supabase
      .from("teams")
      .insert({
        event_id: eventId,
        name: data.name.trim(),
        color: data.color || "#d4a843",
        avatar_url: data.avatar_url || null,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/teams");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true, team };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create team",
    };
  }
}

export async function updateTeamAction(
  teamId: string,
  data: {
    name: string;
    color?: string;
    avatar_url?: string;
  }
) {
  try {
    const { supabase } = await getAuthenticatedUser();

    const { data: team, error } = await supabase
      .from("teams")
      .update({
        name: data.name.trim(),
        color: data.color || "#d4a843",
        avatar_url: data.avatar_url || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", teamId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/teams");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true, team };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update team",
    };
  }
}

export async function softDeleteTeamAction(teamId: string) {
  try {
    const { supabase } = await getAuthenticatedUser();

    const { error } = await supabase
      .from("teams")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", teamId);

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/teams");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete team",
    };
  }
}

export async function restoreTeamAction(teamId: string) {
  try {
    const { supabase } = await getAuthenticatedUser();

    const { error } = await supabase
      .from("teams")
      .update({
        deleted_at: null,
      })
      .eq("id", teamId);

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/teams");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to restore team",
    };
  }
}

// ----------------------------------------------------------------------
// ROUND ACTIONS
// ----------------------------------------------------------------------

export async function createRoundAction(data: { name: string }) {
  try {
    const { supabase } = await getAuthenticatedUser();
    const eventId = await getActiveEventId(supabase);

    // Get current max round number
    const { data: existingRounds } = await supabase
      .from("rounds")
      .select("round_number")
      .eq("event_id", eventId)
      .order("round_number", { ascending: false })
      .limit(1);

    const nextRoundNumber =
      existingRounds && existingRounds.length > 0
        ? existingRounds[0].round_number + 1
        : 1;

    const { data: round, error } = await supabase
      .from("rounds")
      .insert({
        event_id: eventId,
        name: data.name.trim(),
        round_number: nextRoundNumber,
        status: "upcoming",
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/rounds");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true, round };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create round",
    };
  }
}

export async function updateRoundNameAction(roundId: string, name: string) {
  try {
    const { supabase } = await getAuthenticatedUser();

    const { data: round, error } = await supabase
      .from("rounds")
      .update({
        name: name.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", roundId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/rounds");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true, round };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update round name",
    };
  }
}

export async function setRoundStatusAction(
  roundId: string,
  status: "upcoming" | "active" | "completed"
) {
  try {
    const { supabase } = await getAuthenticatedUser();

    // First try the RPC if defined
    const { error: rpcError } = await supabase.rpc("set_round_status", {
      p_round_id: roundId,
      p_status: status,
    });

    if (!rpcError) {
      revalidatePath("/admin/rounds");
      revalidatePath("/admin/dashboard");
      revalidatePath("/admin/score-control");
      revalidatePath("/admin/live-display");
      revalidatePath("/public-view");
      return { success: true };
    }

    // Direct fallback: If activating, enforce single-active round rule
    if (status === "active") {
      const { data: currentRound } = await supabase
        .from("rounds")
        .select("event_id")
        .eq("id", roundId)
        .single();

      if (currentRound?.event_id) {
        await supabase
          .from("rounds")
          .update({
            status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("event_id", currentRound.event_id)
          .eq("status", "active")
          .neq("id", roundId);
      }
    }

    const { error: updateError } = await supabase
      .from("rounds")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", roundId);

    if (updateError) {
      return { success: false, error: updateError.message, code: updateError.code };
    }

    revalidatePath("/admin/rounds");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to change round status",
    };
  }
}

export async function softDeleteRoundAction(roundId: string) {
  try {
    const { supabase } = await getAuthenticatedUser();

    const { error } = await supabase
      .from("rounds")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", roundId);

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/rounds");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete round",
    };
  }
}

export async function restoreRoundAction(roundId: string) {
  try {
    const { supabase } = await getAuthenticatedUser();

    const { error } = await supabase
      .from("rounds")
      .update({
        deleted_at: null,
      })
      .eq("id", roundId);

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/rounds");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/score-control");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to restore round",
    };
  }
}

export async function reorderRoundsAction(orderedRoundIds: string[]) {
  try {
    const { supabase } = await getAuthenticatedUser();
    const eventId = await getActiveEventId(supabase);

    // Call atomic RPC
    const { error: rpcError } = await supabase.rpc("reorder_rounds", {
      p_event_id: eventId,
      p_round_ids: orderedRoundIds,
    });

    if (rpcError) {
      // Fallback if RPC does not exist yet in an unmigrated database
      if (
        rpcError.code === "PGRST202" ||
        rpcError.code === "42883" ||
        rpcError.message?.includes("function")
      ) {
        const tempOffset = 100000;
        for (let i = 0; i < orderedRoundIds.length; i++) {
          await supabase
            .from("rounds")
            .update({ round_number: tempOffset + i + 1 })
            .eq("id", orderedRoundIds[i]);
        }

        for (let i = 0; i < orderedRoundIds.length; i++) {
          const { error } = await supabase
            .from("rounds")
            .update({ round_number: i + 1 })
            .eq("id", orderedRoundIds[i]);

          if (error) {
            return { success: false, error: error.message, code: error.code };
          }
        }
      } else {
        return { success: false, error: rpcError.message, code: rpcError.code };
      }
    }

    revalidatePath("/admin/rounds");
    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reorder rounds",
    };
  }
}

// ----------------------------------------------------------------------
// SCORE TRANSACTIONS ACTIONS
// ----------------------------------------------------------------------

export async function recordScoreBatchAction(params: {
  roundId: string;
  operations: ScoreOperationInput[];
  reason?: string;
  idempotencyKey?: string;
}) {
  try {
    const { supabase } = await getAuthenticatedUser();
    const eventId = await getActiveEventId(supabase);
    const key = params.idempotencyKey;
    if (!key || key.trim() === '') {
      return { success: false, error: 'idempotencyKey is required. The UI must supply a UUID for each scoring batch.' };
    }

    // Invoke authoritative atomic scoring RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "record_score_batch",
      {
        p_event_id: eventId,
        p_round_id: params.roundId,
        p_idempotency_key: key,
        p_operations: params.operations,
        p_reason: params.reason || null,
      }
    );

    if (rpcError) {
      console.error("[recordScoreBatchAction] RPC error:", rpcError);
      return {
        success: false,
        error: rpcError.message || "Failed to commit score batch",
        code: rpcError.code,
      };
    }

    if (!rpcData) {
      return {
        success: false,
        error: "No response received from scoring RPC",
      };
    }

    revalidatePath("/admin/score-control");
    revalidatePath("/admin/history");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    // Broadcast instant real-time notification to active live scoreboards
    try {
      const channel = supabase.channel(`scoreboard:${eventId}`);
      await channel.send({
        type: "broadcast",
        event: "score_update",
        payload: {
          eventId,
          roundId: params.roundId,
          updated_scores: rpcData.updated_scores || {},
          timestamp: Date.now(),
        },
      });
      await supabase.removeChannel(channel);
    } catch {
      // Non-blocking fallback: scoreboards still refresh via Next.js revalidation and interval polling
    }

    return { success: true, data: rpcData };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record score batch",
    };
  }
}

export async function reverseScoreTransactionAction(
  transactionId: string,
  reason: string = "Reversal requested by organizer"
) {
  try {
    const { supabase } = await getAuthenticatedUser();

    // Invoke authoritative reversal RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "reverse_score_transaction",
      {
        p_transaction_id: transactionId,
        p_reason: reason,
      }
    );

    if (rpcError) {
      console.error("[reverseScoreTransactionAction] RPC error:", rpcError);
      return {
        success: false,
        error: rpcError.message || "Failed to reverse transaction",
        code: rpcError.code,
      };
    }

    if (!rpcData) {
      return {
        success: false,
        error: "No response received from reversal RPC",
      };
    }

    revalidatePath("/admin/history");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    // Broadcast instant real-time notification to active live scoreboards
    try {
      const eventId = rpcData.event_id || (await getActiveEventId(supabase));
      const channel = supabase.channel(`scoreboard:${eventId}`);
      await channel.send({
        type: "broadcast",
        event: "score_update",
        payload: {
          eventId,
          teamId: rpcData.team_id,
          resulting_score: rpcData.resulting_score,
          points_delta: rpcData.points_delta,
          timestamp: Date.now(),
        },
      });
      await supabase.removeChannel(channel);
    } catch {
      // Non-blocking fallback
    }

    return { success: true, data: rpcData };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reverse transaction",
    };
  }
}

// ----------------------------------------------------------------------
// EVENT SETTINGS ACTIONS
// ----------------------------------------------------------------------

export async function updateEventSettingsAction(data: {
  leaderboard_visible?: boolean;
  leaderboard_frozen?: boolean;
  starting_score?: number;
  allow_negative_scores?: boolean;
  sort_direction?: "desc" | "asc";
}) {
  try {
    const { supabase } = await getAuthenticatedUser();
    const eventId = await getActiveEventId(supabase);

    if (typeof data.starting_score === "number" && data.starting_score < 0) {
      return { success: false, error: "starting_score must be non-negative (≥ 0)", code: "22023" };
    }

    // Call authoritative RPC enforcing consistent lock hierarchy (events -> event_settings)
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "update_event_settings",
      {
        p_event_id: eventId,
        p_leaderboard_visible:
          typeof data.leaderboard_visible === "boolean"
            ? data.leaderboard_visible
            : null,
        p_leaderboard_frozen:
          typeof data.leaderboard_frozen === "boolean"
            ? data.leaderboard_frozen
            : null,
        p_starting_score:
          typeof data.starting_score === "number" ? data.starting_score : null,
        p_allow_negative_scores:
          typeof data.allow_negative_scores === "boolean"
            ? data.allow_negative_scores
            : null,
        p_sort_direction: data.sort_direction || null,
      }
    );

    if (rpcError) {
      return { success: false, error: rpcError.message, code: rpcError.code };
    }

    revalidatePath("/admin/settings");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/live-display");
    revalidatePath("/public-view");

    return { success: true, data: rpcData };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update settings",
    };
  }
}

// ----------------------------------------------------------------------
// AUTH ACTIONS
// ----------------------------------------------------------------------

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
}