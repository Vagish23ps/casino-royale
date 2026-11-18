#!/usr/bin/env node
// ====================================================================
// CASINO ROYALE — REAL POSTGRESQL / SUPABASE STAGING VERIFICATION SUITE
// Executes against real PostgreSQL / Supabase staging instance.
//
// AUTHENTICATION ARCHITECTURE:
// 1. adminClient (Service-Role):
//    - Creates isolated test event, settings, rounds, teams fixtures
//    - Provisions & assigns two distinct organizer sessions to event_admins
//    - Tears down all fixtures and auto-provisioned accounts in cleanup
// 2. organizerClient1 & organizerClient2 (Two Authenticated Organizers):
//    - Authenticate via real JWT bearer tokens (auth.uid() is NOT NULL)
//    - Verified as event organizers via check_is_event_admin() RPC
//    - Execute concurrent scoring, race condition tests, and reversals
// 3. anonClient (Strictly Anonymous):
//    - Uses pure STAGING_SUPABASE_ANON_KEY (no fallback to service-role)
//    - Verifies security barrier: unauthenticated RPCs are rejected
//    - Verifies public views (v_public_overall_leaderboard) are accessible
// ====================================================================

import { createClient } from "@supabase/supabase-js";

const PRODUCTION_PROJECT_REF = "pwtpfsuhdvdlihjkduhj";

const stagingUrl = process.env.STAGING_SUPABASE_URL;
const stagingServiceRoleKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const stagingAnonKey = process.env.STAGING_SUPABASE_ANON_KEY;

const organizerEmail = process.env.STAGING_ORGANIZER_EMAIL;
const organizerPassword = process.env.STAGING_ORGANIZER_PASSWORD;
const organizerToken = process.env.STAGING_ORGANIZER_ACCESS_TOKEN;

console.log("\n=============================================================");
console.log("CASINO ROYALE — REAL POSTGRESQL STAGING VERIFICATION HARNESS");
console.log("=============================================================\n");

// 1. SAFETY CHECKS & PRODUCTION URL GUARDS
if (!stagingUrl || !stagingServiceRoleKey || !stagingAnonKey) {
  console.error("❌ BLOCKED: Missing PostgreSQL / Supabase staging credentials.");
  console.error("\nRequired environment variables:");
  console.error("  - STAGING_SUPABASE_URL               : Staging project URL (e.g. https://<ref>.supabase.co or http://127.0.0.1:54321)");
  console.error("  - STAGING_SUPABASE_SERVICE_ROLE_KEY  : Staging service-role secret (for admin fixtures, setup, and teardown)");
  console.error("  - STAGING_SUPABASE_ANON_KEY          : Staging anon public key (required for anonymous security tests and public view verification)");
  console.error("\nOptional authentication variables for organizer sessions:");
  console.error("  - STAGING_ORGANIZER_EMAIL            : Existing staging organizer email (auto-provisioned if omitted)");
  console.error("  - STAGING_ORGANIZER_PASSWORD         : Existing staging organizer password");
  console.error("  - STAGING_ORGANIZER_ACCESS_TOKEN     : Direct JWT bearer token for staging organizer\n");
  process.exit(2);
}

if (stagingUrl.toLowerCase().includes(PRODUCTION_PROJECT_REF.toLowerCase())) {
  console.error("🚨 CRITICAL SAFETY GUARD: Configured URL targets the PRODUCTION Supabase instance!");
  console.error(`Target URL: ${stagingUrl}`);
  console.error("Aborting immediately with exit code 3 to protect live tournament data. Testing against production is prohibited.");
  process.exit(3);
}

// Service-role admin client (bypasses RLS for setup, validation, and teardown)
const adminClient = createClient(stagingUrl, stagingServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Anonymous client (strictly public key, no auth session/JWT fallback)
const anonClient = createClient(stagingUrl, stagingAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✓ ${message}`);
}

async function assertThrowsAsync(fn, expectedCodeOrSnippet, message) {
  totalTests++;
  let threw = false;
  let thrownErr = null;
  try {
    await fn();
  } catch (err) {
    threw = true;
    thrownErr = err;
  }

  if (!threw) {
    failedTests++;
    console.error(`  ❌ FAIL (Expected error but succeeded): ${message}`);
    throw new Error(`Expected error containing "${expectedCodeOrSnippet}" but no error was thrown`);
  }

  const errStr = thrownErr?.message || String(thrownErr);
  if (expectedCodeOrSnippet && !errStr.includes(expectedCodeOrSnippet)) {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}. Got unexpected error: ${errStr}`);
    throw new Error(`Expected error containing "${expectedCodeOrSnippet}" but got: ${errStr}`);
  }

  passedTests++;
  console.log(`  ✓ ${message}`);
}

async function runStagingVerification() {
  console.log(`Target Staging URL: ${stagingUrl}`);
  console.log("Initializing clients and validating connection to real PostgreSQL...\n");

  const testRunId = `stg-${Date.now()}`;
  let eventId = null;
  let round1Id = null;
  let round2Id = null;
  let team1Id = null;
  let team2Id = null;
  let team3Id = null;

  const autoProvisionedUserIds = [];
  let organizerClient1 = null;
  let organizerClient2 = null;
  let cleanupFailed = false;

  try {
    // ------------------------------------------------------------------
    // STEP 1: PRE-FLIGHT SCHEMA VERIFICATION
    // ------------------------------------------------------------------
    console.log("--- STEP 1: PRE-FLIGHT SCHEMA & MIGRATION VERIFICATION ---");

    // Verify v_team_round_scores view columns and accessibility
    const { error: vErr } = await adminClient
      .from("v_team_round_scores")
      .select("*")
      .limit(1);

    if (vErr) {
      throw new Error(`v_team_round_scores query failed. Has migration 20261118000000 been applied? Error: ${vErr.message}`);
    }
    assert(true, "v_team_round_scores view accessible");

    // Verify v_public_overall_leaderboard view accessibility
    const { error: lbErr } = await adminClient
      .from("v_public_overall_leaderboard")
      .select("*")
      .limit(1);

    if (lbErr) {
      throw new Error(`v_public_overall_leaderboard query failed: ${lbErr.message}`);
    }
    assert(true, "v_public_overall_leaderboard view accessible");

    // ------------------------------------------------------------------
    // STEP 2: FIXTURE SETUP & TWO AUTHENTICATED ORGANIZER SESSIONS
    // ------------------------------------------------------------------
    console.log("\n--- STEP 2: FIXTURES SETUP & DUAL ORGANIZER SESSIONS ---");

    // 2.1 Create Isolated Test Event via adminClient
    const { data: evData, error: evErr } = await adminClient
      .from("events")
      .insert({
        name: `Automated Staging Verification ${testRunId}`,
        status: "active",
      })
      .select("id")
      .single();

    if (evErr) throw new Error(`Failed to create staging event: ${evErr.message}`);
    eventId = evData.id;
    assert(Boolean(eventId), `Created isolated staging event: ${eventId}`);

    // 2.2 Create Event Settings (starting_score = 140.00, allow_negative_scores = FALSE)
    const { error: setErr } = await adminClient
      .from("event_settings")
      .upsert({
        event_id: eventId,
        starting_score: 140.00,
        allow_negative_scores: false,
        leaderboard_visible: true,
        leaderboard_frozen: false,
        sort_direction: "desc",
      });

    if (setErr) throw new Error(`Failed to initialize event_settings: ${setErr.message}`);
    assert(true, "Initialized event_settings (starting_score: 140.00, allow_negative_scores: false)");

    // 2.3 Create Test Teams
    const { data: tData, error: tErr } = await adminClient
      .from("teams")
      .insert([
        { event_id: eventId, name: `ThunderBolt ${testRunId}`, color: "#eab308" },
        { event_id: eventId, name: `PowerHouse ${testRunId}`, color: "#3b82f6" },
        { event_id: eventId, name: `Royal Flush ${testRunId}`, color: "#ef4444" },
      ])
      .select("id, name");

    if (tErr) throw new Error(`Failed to create test teams: ${tErr.message}`);
    team1Id = tData[0].id;
    team2Id = tData[1].id;
    team3Id = tData[2].id;
    assert(tData.length === 3, "Created 3 test teams");

    // 2.4 Create Test Rounds
    const { data: rData, error: rErr } = await adminClient
      .from("rounds")
      .insert([
        { event_id: eventId, round_number: 1, name: "Round 1 (Qualifiers)", status: "active" },
        { event_id: eventId, round_number: 2, name: "Round 2 (High-Roller)", status: "active" },
        { event_id: eventId, round_number: 3, name: "Round 3 (Finals)", status: "completed" },
      ])
      .select("id, round_number, status");

    if (rErr) throw new Error(`Failed to create test rounds: ${rErr.message}`);
    round1Id = rData.find((r) => r.round_number === 1).id;
    round2Id = rData.find((r) => r.round_number === 2).id;
    assert(rData.length === 3, "Created 3 test rounds");

    // 2.5 Provision Organizer Session 1
    let user1 = null;
    let token1 = null;
    const authSessionClient = createClient(stagingUrl, stagingAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (organizerToken) {
      console.log("  Using provided STAGING_ORGANIZER_ACCESS_TOKEN for Organizer 1...");
      token1 = organizerToken;
      const { data: { user }, error: uErr } = await adminClient.auth.getUser(token1);
      if (uErr || !user) throw new Error(`Invalid STAGING_ORGANIZER_ACCESS_TOKEN: ${uErr?.message}`);
      user1 = user;
    } else if (organizerEmail && organizerPassword) {
      console.log(`  Signing in as Organizer 1 (${organizerEmail})...`);
      const { data: sData, error: sErr } = await authSessionClient.auth.signInWithPassword({
        email: organizerEmail,
        password: organizerPassword,
      });
      if (sErr || !sData.session) throw new Error(`Failed to sign in Organizer 1: ${sErr?.message}`);
      user1 = sData.user;
      token1 = sData.session.access_token;
    } else {
      console.log("  Auto-provisioning Organizer 1...");
      const email1 = `organizer-alpha-${Date.now()}@casino-royale.internal`;
      const pass1 = `CR-Alpha-${Date.now()}!Aa123`;
      const { data: cData, error: cErr } = await adminClient.auth.admin.createUser({
        email: email1,
        password: pass1,
        email_confirm: true,
        user_metadata: { display_name: "Organizer Alpha (Primary)" },
      });
      if (cErr || !cData.user) throw new Error(`Failed to provision Organizer 1: ${cErr?.message}`);
      user1 = cData.user;
      autoProvisionedUserIds.push(user1.id);

      const { data: sData, error: sErr } = await authSessionClient.auth.signInWithPassword({
        email: email1,
        password: pass1,
      });
      if (sErr || !sData.session) throw new Error(`Failed to sign in Organizer 1: ${sErr?.message}`);
      token1 = sData.session.access_token;
    }

    // 2.6 Provision Organizer Session 2 (Distinct Organizer for Concurrency)
    console.log("  Auto-provisioning Organizer 2 (for concurrent scoring & race checks)...");
    const email2 = `organizer-beta-${Date.now()}@casino-royale.internal`;
    const pass2 = `CR-Beta-${Date.now()}!Bb456`;
    const { data: cData2, error: cErr2 } = await adminClient.auth.admin.createUser({
      email: email2,
      password: pass2,
      email_confirm: true,
      user_metadata: { display_name: "Organizer Beta (Secondary)" },
    });
    if (cErr2 || !cData2.user) throw new Error(`Failed to provision Organizer 2: ${cErr2?.message}`);
    const user2 = cData2.user;
    autoProvisionedUserIds.push(user2.id);

    const { data: sData2, error: sErr2 } = await authSessionClient.auth.signInWithPassword({
      email: email2,
      password: pass2,
    });
    if (sErr2 || !sData2.session) throw new Error(`Failed to sign in Organizer 2: ${sErr2?.message}`);
    const token2 = sData2.session.access_token;

    // 2.7 Configure admin_profiles & event_admins for both organizers
    for (const [u, label] of [[user1, "Organizer 1"], [user2, "Organizer 2"]]) {
      const { error: profErr } = await adminClient
        .from("admin_profiles")
        .upsert({
          id: u.id,
          display_name: u.user_metadata?.display_name || label,
          role: "organizer",
        });
      if (profErr) throw new Error(`Failed to configure admin_profile for ${label}: ${profErr.message}`);

      const { error: eaErr } = await adminClient
        .from("event_admins")
        .upsert({
          event_id: eventId,
          admin_id: u.id,
          role: "organizer",
        });
      if (eaErr) throw new Error(`Failed to assign ${label} in event_admins: ${eaErr.message}`);
    }
    assert(true, "Both organizers assigned 'organizer' role in admin_profiles and event_admins");

    // 2.8 Create Authenticated Clients
    organizerClient1 = createClient(stagingUrl, stagingAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token1}` } },
    });

    organizerClient2 = createClient(stagingUrl, stagingAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token2}` } },
    });

    // 2.9 Verify organizer role using real check_is_event_admin() RPC with auth.uid()
    const { data: isAdm1 } = await organizerClient1.rpc("check_is_event_admin", {
      p_event_id: eventId,
      p_required_role: "organizer",
    });
    const { data: isAdm2 } = await organizerClient2.rpc("check_is_event_admin", {
      p_event_id: eventId,
      p_required_role: "organizer",
    });
    assert(isAdm1 === true && isAdm2 === true, "Both organizer clients verified via check_is_event_admin() RPC");

    // 2.10 Anonymous Security Barrier Test: Calling scoring RPC without auth is rejected with 42501
    await assertThrowsAsync(
      async () => {
        const { data, error } = await anonClient.rpc("record_score_batch", {
          p_event_id: eventId,
          p_round_id: round1Id,
          p_idempotency_key: `${testRunId}-unauth-test`,
          p_operations: [{ team_id: team1Id, operation_type: "ADD", input_value: 10 }],
        });
        if (error) throw new Error(`[${error.code || error.message}] ${error.message}`);
        if (data) throw new Error("Unexpected success: anonymous caller was able to execute record_score_batch");
      },
      "42501",
      "Anonymous caller rejected by record_score_batch with ERRCODE 42501 (Permission denied / Unauthorized)"
    );

    // 2.11 Direct Authenticated event_settings Writes Denied
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.from("event_settings").insert({
          event_id: eventId,
          starting_score: 999.00,
        });
        if (error) throw new Error(`[${error.code || error.message}] ${error.message}`);
      },
      "42501",
      "Direct INSERT on event_settings from authenticated is denied with ERRCODE 42501"
    );

    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1
          .from("event_settings")
          .update({ starting_score: 999.00 })
          .eq("event_id", eventId);
        if (error) throw new Error(`[${error.code || error.message}] ${error.message}`);
      },
      "42501",
      "Direct UPDATE on event_settings from authenticated is denied with ERRCODE 42501"
    );

    // 2.12 Changing starting_score BEFORE score transactions exist is allowed via validated RPC
    const { data: preTxRes, error: preTxErr } = await organizerClient1.rpc("update_event_settings", {
      p_event_id: eventId,
      p_starting_score: 160.00,
    });
    if (preTxErr) throw new Error(`update_event_settings failed before transactions: ${preTxErr.message}`);
    assert(Number(preTxRes.settings.starting_score) === 160, "Changing starting_score before score transactions exist is allowed");

    // Restore starting_score to 140.00 for subsequent test baseline
    const { data: resetPreRes, error: resetPreErr } = await organizerClient1.rpc("update_event_settings", {
      p_event_id: eventId,
      p_starting_score: 140.00,
    });
    if (resetPreErr) throw new Error(`Failed to restore starting_score: ${resetPreErr.message}`);
    assert(Number(resetPreRes.settings.starting_score) === 140, "Restored starting_score to 140.00 baseline");

    // ------------------------------------------------------------------
    // STEP 3: STRICT INPUT VALIDATION (AUTHENTICATED RPC)
    // ------------------------------------------------------------------
    console.log("\n--- STEP 3: STRICT INPUT VALIDATION (AUTHENTICATED RPC) ---");

    // Reject NULL idempotency key
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("record_score_batch", {
          p_event_id: eventId,
          p_round_id: round1Id,
          p_idempotency_key: null,
          p_operations: [{ team_id: team1Id, operation_type: "ADD", input_value: 10 }],
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "22004",
      "Reject NULL idempotency key with ERRCODE 22004"
    );

    // Reject empty array operations
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("record_score_batch", {
          p_event_id: eventId,
          p_round_id: round1Id,
          p_idempotency_key: `${testRunId}-val-1`,
          p_operations: [],
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "22023",
      "Reject empty array p_operations with ERRCODE 22023"
    );

    // Reject invalid operation type
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("record_score_batch", {
          p_event_id: eventId,
          p_round_id: round1Id,
          p_idempotency_key: `${testRunId}-val-2`,
          p_operations: [{ team_id: team1Id, operation_type: "MODULO", input_value: 10 }],
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "22023",
      "Reject invalid operation_type with ERRCODE 22023"
    );

    // Reject precision exceeding 2 decimal places
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("record_score_batch", {
          p_event_id: eventId,
          p_round_id: round1Id,
          p_idempotency_key: `${testRunId}-val-3`,
          p_operations: [{ team_id: team1Id, operation_type: "ADD", input_value: "10.555" }],
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "22023",
      "Reject >2 decimal places (no silent rounding) with ERRCODE 22023"
    );

    // ------------------------------------------------------------------
    // STEP 4: FIVE ARITHMETIC OPERATIONS AGAINST OVERALL TOURNAMENT SCORE
    // ------------------------------------------------------------------
    console.log("\n--- STEP 4: ARITHMETIC OPERATIONS (OVERALL SCORE 140 BASE) ---");

    // 1. ADD 10 on 140 -> 150
    const { data: addData, error: addErr } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-op-add`,
      p_operations: [{ team_id: team1Id, operation_type: "ADD", input_value: 10 }],
      p_reason: "ADD 10 test",
    });
    if (addErr) throw addErr;
    assert(addData.transactions[0].previous_score === 140, "ADD: previous_score is 140");
    assert(addData.transactions[0].resulting_score === 150, "ADD: resulting_score is 150");
    assert(addData.transactions[0].points_delta === 10, "ADD: points_delta is +10");

    // 2. SUBTRACT 20 on 150 -> 130
    const { data: subData, error: subErr } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-op-sub`,
      p_operations: [{ team_id: team1Id, operation_type: "SUBTRACT", input_value: 20 }],
      p_reason: "SUBTRACT 20 test",
    });
    if (subErr) throw subErr;
    assert(subData.transactions[0].previous_score === 150, "SUBTRACT: previous_score is 150");
    assert(subData.transactions[0].resulting_score === 130, "SUBTRACT: resulting_score is 130");
    assert(subData.transactions[0].points_delta === -20, "SUBTRACT: points_delta is -20");

    // 3. MULTIPLY 2 on 130 -> 260
    const { data: mulData, error: mulErr } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-op-mul`,
      p_operations: [{ team_id: team1Id, operation_type: "MULTIPLY", input_value: 2 }],
      p_reason: "MULTIPLY 2 test",
    });
    if (mulErr) throw mulErr;
    assert(mulData.transactions[0].previous_score === 130, "MULTIPLY: previous_score is 130");
    assert(mulData.transactions[0].resulting_score === 260, "MULTIPLY: resulting_score is 260");
    assert(mulData.transactions[0].points_delta === 130, "MULTIPLY: points_delta is +130");

    // 4. DIVIDE 2 on 260 -> 130
    const { data: divData, error: divErr } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-op-div`,
      p_operations: [{ team_id: team1Id, operation_type: "DIVIDE", input_value: 2 }],
      p_reason: "DIVIDE 2 test",
    });
    if (divErr) throw divErr;
    assert(divData.transactions[0].previous_score === 260, "DIVIDE: previous_score is 260");
    assert(divData.transactions[0].resulting_score === 130, "DIVIDE: resulting_score is 130");
    assert(divData.transactions[0].points_delta === -130, "DIVIDE: points_delta is -130");

    // 5. SET_SCORE 40 on current overall 130 in Round 2
    const { data: setData, error: setErr2 } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round2Id,
      p_idempotency_key: `${testRunId}-op-set-40`,
      p_operations: [{ team_id: team1Id, operation_type: "SET_SCORE", input_value: 40 }],
      p_reason: "SET_SCORE 40 test",
    });
    if (setErr2) throw setErr2;
    assert(setData.transactions[0].previous_score === 130, "SET_SCORE 40: previous_score is 130");
    assert(setData.transactions[0].resulting_score === 40, "SET_SCORE 40: resulting_score is exactly 40");
    assert(setData.transactions[0].points_delta === -90, "SET_SCORE 40: points_delta is -90");

    // Verify Leaderboard matches resulting_score 40 via anonClient
    const { data: lbCheck1 } = await anonClient
      .from("v_public_overall_leaderboard")
      .select("total_score")
      .eq("team_id", team1Id)
      .single();
    assert(Number(lbCheck1.total_score) === 40, "Public leaderboard total_score matches SET_SCORE 40 via anonClient");

    // Restore back: SET_SCORE 140
    const { data: setRestoreData } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round2Id,
      p_idempotency_key: `${testRunId}-op-set-140`,
      p_operations: [{ team_id: team1Id, operation_type: "SET_SCORE", input_value: 140 }],
    });
    assert(setRestoreData.transactions[0].resulting_score === 140, "SET_SCORE 140 restored score to 140");

    // ------------------------------------------------------------------
    // STEP 5: SEQUENTIAL ORDERING & ATOMIC ROLLBACK (SINGLE CLIENT)
    // ------------------------------------------------------------------
    console.log("\n--- STEP 5: SEQUENTIAL ORDERING & ATOMIC ROLLBACK (SINGLE CLIENT) ---");

    // Intra-batch sequential operations on Team 2
    // Op 0: ADD 60 (140 -> 200)
    // Op 1: SUBTRACT 50 (200 -> 150)
    // Op 2: MULTIPLY 2 (150 -> 300)
    const { data: seqData, error: seqErr } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-seq-batch`,
      p_operations: [
        { team_id: team2Id, operation_type: "ADD", input_value: 60 },
        { team_id: team2Id, operation_type: "SUBTRACT", input_value: 50 },
        { team_id: team2Id, operation_type: "MULTIPLY", input_value: 2 },
      ],
    });
    if (seqErr) throw seqErr;
    assert(seqData.transactions.length === 3, "Sequential batch committed all 3 transactions");
    assert(seqData.transactions[0].resulting_score === 200, "Op 0 (ADD 60): 140 -> 200");
    assert(seqData.transactions[1].resulting_score === 150, "Op 1 (SUBTRACT 50): 200 -> 150");
    assert(seqData.transactions[2].resulting_score === 300, "Op 2 (MULTIPLY 2): 150 -> 300");

    // Atomic Rollback: batch with 1 invalid operation (DIVIDE by 0)
    const { count: txCountBefore } = await adminClient
      .from("score_transactions")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);

    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("record_score_batch", {
          p_event_id: eventId,
          p_round_id: round1Id,
          p_idempotency_key: `${testRunId}-fail-batch`,
          p_operations: [
            { team_id: team1Id, operation_type: "ADD", input_value: 50 },
            { team_id: team2Id, operation_type: "DIVIDE", input_value: 0 },
            { team_id: team3Id, operation_type: "ADD", input_value: 50 },
          ],
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "22012",
      "Division by zero rejects entire batch with ERRCODE 22012"
    );

    const { count: txCountAfter } = await adminClient
      .from("score_transactions")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);

    assert(txCountBefore === txCountAfter, "Atomic rollback: zero partial transactions committed");

    // ------------------------------------------------------------------
    // STEP 6: REAL CONCURRENT SCORING & RACING CONDITIONS (DUAL CLIENTS)
    // ------------------------------------------------------------------
    console.log("\n--- STEP 6: REAL CONCURRENCY & RACE CONDITIONS (DUAL CLIENTS) ---");

    // 6.1 Simultaneous ADD operations on the same team from two separate organizers
    // Team 2 is currently at 300.00.
    // Organizer 1 submits ADD 25.00; Organizer 2 submits ADD 35.00 simultaneously via Promise.all.
    console.log("  Executing simultaneous ADD submissions on Team 2 via Promise.all...");
    const concAddP1 = organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-conc-add-org1`,
      p_operations: [{ team_id: team2Id, operation_type: "ADD", input_value: 25 }],
      p_reason: "Concurrent ADD by Organizer 1",
    });

    const concAddP2 = organizerClient2.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-conc-add-org2`,
      p_operations: [{ team_id: team2Id, operation_type: "ADD", input_value: 35 }],
      p_reason: "Concurrent ADD by Organizer 2",
    });

    const [concRes1, concRes2] = await Promise.all([concAddP1, concAddP2]);
    if (concRes1.error) throw new Error(`Concurrent ADD Org1 failed: ${concRes1.error.message}`);
    if (concRes2.error) throw new Error(`Concurrent ADD Org2 failed: ${concRes2.error.message}`);

    assert(concRes1.data.success && concRes2.data.success, "Simultaneous ADD submissions both succeeded");

    // Verify both transactions are preserved in the ledger and team score is exactly 360 (300 + 25 + 35)
    const { data: t2Txs } = await adminClient
      .from("score_transactions")
      .select("id, points_delta, resulting_score")
      .eq("team_id", team2Id)
      .in("idempotency_key", [`${testRunId}-conc-add-org1`, `${testRunId}-conc-add-org2`]);

    assert(t2Txs.length === 2, "Both concurrent transactions preserved in score_transactions ledger");

    const { data: t2Leaderboard } = await anonClient
      .from("v_public_overall_leaderboard")
      .select("total_score")
      .eq("team_id", team2Id)
      .single();
    assert(Number(t2Leaderboard.total_score) === 360, "Team 2 overall score reflects both concurrent additions (300 + 25 + 35 = 360.00)");

    // 6.2 Simultaneous Reversal Requests for the same original transaction
    console.log("  Executing simultaneous duplicate reversals for the same transaction via Promise.allSettled...");
    const { data: addT1Data, error: addT1Err } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-race-rev-target`,
      p_operations: [{ team_id: team1Id, operation_type: "ADD", input_value: 50 }],
      p_reason: "Target transaction for concurrent reversal race",
    });
    if (addT1Err) throw addT1Err;
    const raceTargetTxId = addT1Data.transactions[0].id;

    const revRaceP1 = organizerClient1.rpc("reverse_score_transaction", {
      p_transaction_id: raceTargetTxId,
      p_reason: "Concurrent reversal attempt by Organizer 1",
    });
    const revRaceP2 = organizerClient2.rpc("reverse_score_transaction", {
      p_transaction_id: raceTargetTxId,
      p_reason: "Concurrent reversal attempt by Organizer 2",
    });

    const [revSettled1, revSettled2] = await Promise.allSettled([revRaceP1, revRaceP2]);

    const revSucceeded = [revSettled1, revSettled2].filter(
      (r) => r.status === "fulfilled" && !r.value.error && r.value.data?.success === true
    );
    const revRejected = [revSettled1, revSettled2].filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error)
    );

    assert(revSucceeded.length === 1, "Exactly one concurrent reversal succeeded");
    assert(revRejected.length === 1, "The competing concurrent reversal was rejected");

    // Verify in database that EXACTLY one reversal record exists for raceTargetTxId
    const { count: actualReversalCount } = await adminClient
      .from("score_transactions")
      .select("id", { count: "exact", head: true })
      .eq("reversal_of_transaction_id", raceTargetTxId);

    assert(actualReversalCount === 1, "Unique partial index & row lock guaranteed exactly ONE reversal record in database");

    // 6.3 Settings Update racing with Scoring Submission (Locking order dead-lock prevention)
    console.log("  Executing simultaneous settings update racing with scoring submission...");
    const raceSettingsP = organizerClient1.rpc("update_event_settings", {
      p_event_id: eventId,
      p_leaderboard_visible: true,
      p_leaderboard_frozen: false,
      p_starting_score: 140.00,
      p_allow_negative_scores: false,
      p_sort_direction: "asc", // Actual harmless settings change: 'desc' -> 'asc'
    });

    const raceScoringP = organizerClient2.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-race-settings-score`,
      p_operations: [{ team_id: team3Id, operation_type: "ADD", input_value: 15 }],
      p_reason: "Scoring racing with settings update",
    });

    const [settingsRes, scoringRes] = await Promise.all([raceSettingsP, raceScoringP]);
    if (settingsRes.error) throw new Error(`Racing settings update failed: ${settingsRes.error.message}`);
    if (scoringRes.error) throw new Error(`Racing scoring submission failed: ${scoringRes.error.message}`);

    assert(settingsRes.data.success && scoringRes.data.success, "Settings update and scoring submission completed concurrently without deadlock");

    // Verify final settings value in database
    const { data: verifiedSettings, error: getSettingsErr } = await adminClient
      .from("event_settings")
      .select("sort_direction")
      .eq("event_id", eventId)
      .single();
    if (getSettingsErr) throw new Error(`Failed to fetch event_settings: ${getSettingsErr.message}`);
    assert(verifiedSettings.sort_direction === "asc", "Event settings successfully updated to sort_direction: 'asc'");

    // Verify successful scoring in database
    const { data: verifiedTx, error: getTxErr } = await adminClient
      .from("score_transactions")
      .select("id, points_delta")
      .eq("idempotency_key", `${testRunId}-race-settings-score`)
      .single();
    if (getTxErr) throw new Error(`Failed to fetch racing score transaction: ${getTxErr.message}`);
    assert(Number(verifiedTx.points_delta) === 15, "Concurrent scoring transaction committed with points_delta: +15");

    // Restore original setting ('desc') before subsequent tests and ledger reconciliation
    const { data: restoreRes, error: restoreErr } = await organizerClient1.rpc("update_event_settings", {
      p_event_id: eventId,
      p_leaderboard_visible: true,
      p_leaderboard_frozen: false,
      p_starting_score: 140.00,
      p_allow_negative_scores: false,
      p_sort_direction: "desc",
    });
    if (restoreErr) throw new Error(`Failed to restore event_settings: ${restoreErr.message}`);
    assert(restoreRes.success === true, "Restored event_settings sort_direction to 'desc' for clean downstream reconciliation");

    // ------------------------------------------------------------------
    // STEP 7: IDEMPOTENCY KEY CACHING & CONFLICT DETECTION
    // ------------------------------------------------------------------
    console.log("\n--- STEP 7: IDEMPOTENCY CACHING & CONFLICT DETECTION ---");

    const idemKey = `${testRunId}-idem-key-1`;
    const payloadA = [{ team_id: team3Id, operation_type: "ADD", input_value: 35 }];

    // First call: succeeds
    const { data: idemRes1 } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: idemKey,
      p_operations: payloadA,
      p_reason: "Payload A",
    });
    assert(idemRes1.transactions_count === 1, "First idempotency submission processed");

    // Retrying identical batch with same key and payload returns cached
    const { data: idemRes2 } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: idemKey,
      p_operations: payloadA,
      p_reason: "Payload A",
    });
    assert(idemRes2.transactions_count === 1, "Retry returns cached response");
    assert(idemRes2.transaction_ids[0] === idemRes1.transaction_ids[0], "Retry transaction IDs match cached IDs");

    // Attempting to reuse same key with DIFFERENT payload must be rejected
    const payloadB = [{ team_id: team3Id, operation_type: "ADD", input_value: 70 }];
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("record_score_batch", {
          p_event_id: eventId,
          p_round_id: round1Id,
          p_idempotency_key: idemKey,
          p_operations: payloadB,
          p_reason: "Payload B Different",
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "23505",
      "Reusing idempotency key with different payload is rejected with ERRCODE 23505"
    );

    // ------------------------------------------------------------------
    // STEP 8: SEQUENTIAL REVERSALS & REVERSING REVERSAL REJECTION
    // ------------------------------------------------------------------
    console.log("\n--- STEP 8: REVERSAL VERIFICATION ---");

    // Create a transaction to reverse: Add 50 on Team 3
    const { data: addT3Data } = await organizerClient1.rpc("record_score_batch", {
      p_event_id: eventId,
      p_round_id: round1Id,
      p_idempotency_key: `${testRunId}-rev-tx-add`,
      p_operations: [{ team_id: team3Id, operation_type: "ADD", input_value: 50 }],
      p_reason: "Original add to be reversed",
    });
    const origTxId = addT3Data.transactions[0].id;
    const scoreBeforeRev = addT3Data.transactions[0].resulting_score;

    // First reversal: succeeds
    const { data: revData1, error: revErr1 } = await organizerClient1.rpc("reverse_score_transaction", {
      p_transaction_id: origTxId,
      p_reason: "Reversing accidental add",
    });
    if (revErr1) throw revErr1;
    assert(revData1.success === true, "First reversal successfully processed");
    assert(revData1.points_delta === -50, "Reversal points delta is -50");
    assert(revData1.resulting_score === scoreBeforeRev - 50, "Reversal restored Team 3 score");

    // Subsequent sequential reversal attempt: rejected
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("reverse_score_transaction", {
          p_transaction_id: origTxId,
          p_reason: "Subsequent reversal attempt",
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "23505",
      "Subsequent reversal blocked with ERRCODE 23505"
    );

    // Reversing a reversal record directly is rejected
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("reverse_score_transaction", {
          p_transaction_id: revData1.reversal_transaction_id,
          p_reason: "Reverse a reversal",
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "reversal record",
      "Reversing a reversal record directly blocked"
    );

    // ------------------------------------------------------------------
    // STEP 9: NEGATIVE SCORE POLICY ENFORCEMENT
    // ------------------------------------------------------------------
    console.log("\n--- STEP 9: NEGATIVE SCORE POLICY ENFORCEMENT ---");

    // Scoring that produces a negative score when allow_negative_scores is FALSE is rejected
    await assertThrowsAsync(
      async () => {
        const { error } = await organizerClient1.rpc("record_score_batch", {
          p_event_id: eventId,
          p_round_id: round1Id,
          p_idempotency_key: `${testRunId}-neg-fail`,
          p_operations: [{ team_id: team1Id, operation_type: "SUBTRACT", input_value: 9999 }],
        });
        if (error) throw new Error(`[${error.code}] ${error.message}`);
      },
      "22000",
      "Negative score rejected when allow_negative_scores is FALSE"
    );

    // 9.2 Starting Score Immutability & Event Settings Verification After Transactions Exist
    // Changing starting_score after score transactions exist MUST be rejected
    await assertThrowsAsync(
      async () => {
        const { data, error } = await organizerClient1.rpc("update_event_settings", {
          p_event_id: eventId,
          p_starting_score: 250.00,
        });
        if (error) throw new Error(`[${error.code || error.message}] ${error.message}`);
        if (data) throw new Error("Unexpected success modifying starting_score after transactions exist");
      },
      "22023",
      "Changing starting_score after score transactions exist is rejected with ERRCODE 22023"
    );

    // Supplying identical existing starting_score value (140.00) remains allowed
    const { data: sameScoreRes, error: sameScoreErr } = await organizerClient1.rpc("update_event_settings", {
      p_event_id: eventId,
      p_starting_score: 140.00,
    });
    if (sameScoreErr) throw new Error(`Supplying existing starting_score failed: ${sameScoreErr.message}`);
    assert(sameScoreRes.success === true, "Supplying identical existing starting_score value (140.00) remains allowed");

    // Updating unrelated settings (leaderboard_visible, sort_direction) after transactions exist still works
    const { data: unrelatedRes, error: unrelatedErr } = await organizerClient1.rpc("update_event_settings", {
      p_event_id: eventId,
      p_leaderboard_visible: true,
      p_sort_direction: "desc",
    });
    if (unrelatedErr) throw new Error(`Updating unrelated settings failed: ${unrelatedErr.message}`);
    assert(unrelatedRes.success === true, "Updating unrelated settings after transactions exist continues working");

    // ------------------------------------------------------------------
    // STEP 10: FULL LEDGER RECONCILIATION ACROSS VIEWS & TABLES
    // ------------------------------------------------------------------
    console.log("\n--- STEP 10: FULL LEDGER RECONCILIATION ACROSS VIEWS & TABLES ---");

    const { data: allTxs } = await adminClient
      .from("score_transactions")
      .select("points_delta")
      .eq("event_id", eventId);

    const sumDeltas = allTxs.reduce((sum, tx) => sum + Number(tx.points_delta), 0);
    const expectedTournamentTotal = (140.00 * 3) + sumDeltas;

    const { data: lbTeams } = await anonClient
      .from("v_public_overall_leaderboard")
      .select("total_score")
      .eq("event_id", eventId);

    const actualLeaderboardTotal = lbTeams.reduce((sum, tm) => sum + Number(tm.total_score), 0);

    assert(
      Math.abs(expectedTournamentTotal - actualLeaderboardTotal) < 0.01,
      `Full Ledger Reconciled: sum of transaction deltas + starting scores (${expectedTournamentTotal}) matches public leaderboard (${actualLeaderboardTotal})`
    );

    // Verify v_team_round_scores breakdown columns via organizerClient1
    const { data: rScores } = await organizerClient1
      .from("v_team_round_scores")
      .select("earned_points, adjustment_points, reversal_points, has_score_reset, has_reversal")
      .eq("event_id", eventId);

    assert(rScores.length > 0, "v_team_round_scores returned breakdown records to organizer");
    assert(rScores.some((r) => r.has_score_reset === true), "v_team_round_scores tracks SET_SCORE in has_score_reset");
    assert(rScores.some((r) => r.has_reversal === true), "v_team_round_scores tracks reversals in has_reversal");

  } finally {
    // ------------------------------------------------------------------
    // STEP 11: CLEANUP FIXTURES & TEMPORARY ACCOUNTS (ADMIN CLIENT)
    // ------------------------------------------------------------------
    console.log("\n--- STEP 11: CLEANING UP STAGING FIXTURES (ADMIN CLIENT) ---");
    const cleanupErrors = [];

    if (eventId) {
      const tables = [
        "score_transactions",
        "idempotency_records",
        "event_admins",
        "teams",
        "rounds",
        "event_settings",
      ];

      for (const table of tables) {
        const { error: delErr } = await adminClient.from(table).delete().eq("event_id", eventId);
        if (delErr) {
          cleanupErrors.push(`Failed to delete records from ${table}: ${delErr.message}`);
        }
      }

      const { error: evDelErr } = await adminClient.from("events").delete().eq("id", eventId);
      if (evDelErr) {
        cleanupErrors.push(`Failed to delete event ${eventId}: ${evDelErr.message}`);
      }

      // Verify event was deleted
      const { data: evCheck, error: evCheckErr } = await adminClient
        .from("events")
        .select("id")
        .eq("id", eventId)
        .maybeSingle();

      if (evCheckErr) {
        cleanupErrors.push(`Failed to verify event deletion: ${evCheckErr.message}`);
      } else if (evCheck) {
        cleanupErrors.push(`Verification failed: Test event ${eventId} still exists in database!`);
      }
    }

    // Remove auto-provisioned users
    for (const uid of autoProvisionedUserIds) {
      const { error: uDelErr } = await adminClient.auth.admin.deleteUser(uid);
      if (uDelErr) {
        cleanupErrors.push(`Failed to delete auto-provisioned user ${uid}: ${uDelErr.message}`);
      }

      const { data: uCheck } = await adminClient.auth.admin.getUserById(uid);
      if (uCheck?.user) {
        cleanupErrors.push(`Verification failed: Auto-provisioned user ${uid} still exists in auth!`);
      }
    }

    if (cleanupErrors.length > 0) {
      cleanupFailed = true;
      console.error("\n❌ CLEANUP ENCOUNTERED ERRORS:");
      for (const err of cleanupErrors) {
        console.error(`  - ${err}`);
      }
    } else {
      console.log(`  ✓ Cleaned up and verified removal of all staging fixtures and temporary test accounts.`);
    }
  }

  console.log("\n=============================================================");
  console.log(`STAGING VERIFICATION SUMMARY: ${passedTests} passed, ${failedTests} failed out of ${totalTests} total tests.`);
  if (cleanupFailed) {
    console.error("❌ TEARDOWN FAILED: Staging cleanup did not complete cleanly.");
  }
  console.log("=============================================================\n");

  if (failedTests > 0 || cleanupFailed) {
    process.exit(1);
  }
}

runStagingVerification().catch((err) => {
  console.error("\n❌ STAGING VERIFICATION ENCOUNTERED FATAL ERROR:", err.message || err);
  process.exit(1);
});
