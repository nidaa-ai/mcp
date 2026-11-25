#!/usr/bin/env node
/**
 * Nidaa — bridge loop test (run against a local dev server).
 * Verifies the "never end the call" contract end-to-end at the API level:
 *
 *   notify_task_complete → RINGING keep-alive → (user answers) →
 *   user speaks via the custom-LLM bridge → ChatGPT replies with
 *   send_call_update (must be spoken instantly by the LLM bridge) →
 *   USER_SAID directive → HEARTBEAT silence → IN_LOOP status →
 *   user hangs up from the app → CALL_ENDED (only exit).
 *
 * Usage: node scripts/test-bridge-loop.mjs http://localhost:3112
 * Pair with scripts/test-bridge-loop.sh (boots the server).
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

const APP = process.argv[2]?.replace(/\/+$/, "");
if (!APP) {
  console.error("Usage: node scripts/test-bridge-loop.mjs http://localhost:PORT");
  process.exit(1);
}

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAgentKey() {
  if (process.env.AGENT_API_KEY) return process.env.AGENT_API_KEY;
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const rs = await db.execute("SELECT value FROM settings WHERE key = 'agent_api_key'");
  return rs.rows[0]?.value ?? null;
}

async function mcp(key, method, params) {
  const res = await fetch(`${APP}/api/mcp?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return res.json();
}

function payloadOf(resp) {
  return JSON.parse(resp.result?.content?.[0]?.text ?? "{}");
}

/** Reassemble the assistant text from an OpenAI-style SSE stream. */
function sseText(raw) {
  let out = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    try {
      const j = JSON.parse(line.slice(6));
      for (const ch of j.choices ?? []) out += ch.delta?.content ?? "";
    } catch { /* usage / keepalive lines */ }
  }
  return out;
}

async function main() {
  console.log(`\nNidaa bridge loop test → ${APP}\n`);

  const key = await getAgentKey();
  check("resolve AGENT_API_KEY", !!key, key ? `${String(key).slice(0, 12)}…` : "not found");
  if (!key) process.exit(1);

  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

  /* 1 — initialize: the contract must travel with the server instructions */
  const init = await mcp(key, "initialize", { protocolVersion: "2025-06-18" });
  const instr = init.result?.instructions ?? "";
  check(
    "initialize carries the loop + live-command contract",
    instr.includes("MUST NOT end your turn") &&
      instr.includes("heartbeat") &&
      instr.includes("live command stream") &&
      instr.includes("THIS SAME session"),
  );

  /* 2 — tools/list: the contract must travel with the tool descriptions */
  const tools = await mcp(key, "tools/list");
  const waitTool = (tools.result?.tools ?? []).find((t) => t.name === "wait_for_call_updates");
  check(
    "wait tool description is a keep-alive contract",
    /keep-alive|heartbeat/i.test(waitTool?.description ?? "") && /never end your turn/i.test(waitTool?.description ?? ""),
  );

  /* 3 — notify → CALL_STARTED directive, loop must begin */
  const call = await mcp(key, "tools/call", {
    name: "notify_task_complete",
    arguments: { summary: "bridge loop test — مهمة الاختبار خلصت", title: "اختبار الجسر (تجاهل الرنّة)" },
  });
  const c1 = payloadOf(call);
  const callId = c1.call_id;
  check(
    "notify → CALL_STARTED + keep_looping",
    c1.directive?.startsWith("CALL_STARTED") && c1.keep_looping === true && !!callId,
    `call ${callId}`,
  );

  /* 4 — first wait while ringing → RINGING keep-alive (not an exit signal) */
  const w1 = await mcp(key, "tools/call", {
    name: "wait_for_call_updates",
    arguments: { call_id: callId, wait_seconds: 2 },
  });
  const p1 = payloadOf(w1);
  check(
    "wait(ringing) → RINGING keep-alive",
    p1.directive?.startsWith("RINGING") && p1.ended === false && p1.keep_looping === true,
    `status ${p1.status}, next_since ${p1.next_since}`,
  );

  /* 5 — the user answers (browser answer route needs Fish; set state directly) */
  await db.execute({ sql: "UPDATE calls SET status = 'active', answered_at = ? WHERE id = ?", args: [Date.now(), callId] });

  /* 6 — user speaks through the custom-LLM bridge; ChatGPT replies 1.2s later */
  const llmPromise = fetch(`${APP}/api/llm/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "bridge-test",
      stream: true,
      messages: [{ role: "user", content: "فاتورة الكهربا اتدفعت النهاردة؟" }],
      fishaudio_extra_body: { call_id: callId },
    }),
  }).then(async (r) => ({ ok: r.ok, status: r.status, text: await r.text() }));

  await sleep(1200);

  const upd = await mcp(key, "tools/call", {
    name: "send_call_update",
    arguments: { call_id: callId, message: "أيوه، فاتورة الكهربا اتدفعت من الصبح.", kind: "result" },
  });
  const up1 = payloadOf(upd);
  check(
    "send_call_update → SPOKEN_LIVE + still on the line",
    up1.directive?.startsWith("SPOKEN_LIVE") && up1.keep_looping === true,
    `seq ${up1.seq}`,
  );

  const llm = await llmPromise;
  const spoken = sseText(llm.text);
  check(
    "LLM bridge spoke the agent reply instantly",
    llm.ok && spoken.includes("فاتورة الكهربا اتدفعت"),
    `status ${llm.status}, spoken: ${spoken.slice(0, 40)}`,
  );

  /* 7 — next poll: the user utterance must arrive as USER_SAID */
  const w2 = await mcp(key, "tools/call", {
    name: "wait_for_call_updates",
    arguments: { call_id: callId, since: p1.next_since, wait_seconds: 2 },
  });
  const p2 = payloadOf(w2);
  check(
    "wait → USER_SAID directive with the utterance + same-session order",
    p2.directive?.startsWith("USER_SAID") &&
      p2.directive.includes("live working session together") &&
      (p2.user_speech ?? []).some((u) => (u.text ?? "").includes("فاتورة")),
    `${p2.user_speech?.length ?? 0} speech / ${p2.your_updates_echo?.length ?? 0} echo`,
  );

  /* 8 — silence → HEARTBEAT (must demand another poll, not an exit) */
  const w3 = await mcp(key, "tools/call", {
    name: "wait_for_call_updates",
    arguments: { call_id: callId, since: p2.next_since, wait_seconds: 2 },
  });
  const p3 = payloadOf(w3);
  check(
    "wait(silence) → HEARTBEAT keep-alive",
    p3.directive?.startsWith("HEARTBEAT") && p3.keep_looping === true && (p3.user_speech ?? []).length === 0,
    `age ${p3.age_seconds}s`,
  );

  /* 9 — get_call_status: in the loop */
  const st = await mcp(key, "tools/call", { name: "get_call_status", arguments: { call_id: callId } });
  const sp = payloadOf(st);
  check("get_call_status → IN_LOOP", sp.directive?.startsWith("IN_LOOP"));

  /* 10 — the user (and only the user) hangs up from the app */
  const dev = await fetch(`${APP}/api/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "bridge-test@nidaa.dev", label: "bridge-loop-test" }),
  }).then((r) => r.json());
  const end = await fetch(`${APP}/api/calls/${callId}/end`, {
    method: "POST",
    headers: { "x-device-token": dev.device_token },
  }).then((r) => r.json());
  check("user hangup via device token", end.ended_by === "user" && end.status === "ended", JSON.stringify(end));

  /* 11 — final poll → CALL_ENDED, exit now allowed */
  const w4 = await mcp(key, "tools/call", {
    name: "wait_for_call_updates",
    arguments: { call_id: callId, since: p3.next_since, wait_seconds: 2 },
  });
  const p4 = payloadOf(w4);
  check(
    "wait after hangup → CALL_ENDED (exit allowed)",
    p4.directive?.startsWith("CALL_ENDED") && p4.ended === true && p4.keep_looping === false,
    `ended_by ${p4.ended_by}`,
  );

  /* cleanup — leave no test rows behind */
  await db.execute({ sql: "DELETE FROM call_events WHERE call_id = ?", args: [callId] });
  await db.execute({ sql: "DELETE FROM calls WHERE id = ?", args: [callId] });
  await db.execute({ sql: "DELETE FROM devices WHERE id = ?", args: [dev.device_token] });
  await db.execute({ sql: "DELETE FROM users WHERE email = ?", args: ["bridge-test@nidaa.dev"] });
  check("cleanup test rows", true);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "ALL CHECKS PASSED ✓" : `${failed.length} CHECKS FAILED ✗`}\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("bridge loop test crashed:", e);
  process.exit(1);
});
