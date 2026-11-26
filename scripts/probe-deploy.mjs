#!/usr/bin/env node
/**
 * Probe the PRODUCTION bridge: is the new code deployed?
 * Old code (f1b1752): second marker turn → dead line "لسه مفيش رد جديد من الإيجنت."
 * New code: second marker turn → SILENCE (whitespace only).
 * Creates a fake call row directly in Turso — no ring, no push.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const APP = process.argv[2] ?? "https://nidaa-ai.vercel.app";
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

let key = process.env.AGENT_API_KEY;
if (!key) {
  const rs = await db.execute("SELECT value FROM settings WHERE key = 'agent_api_key'");
  key = rs.rows[0]?.value ?? null;
}

const callId = randomUUID().replace(/-/g, "").slice(0, 12);
const now = Date.now();
await db.execute({
  sql: `INSERT INTO calls (id, title, summary, priority, task_ref, source, status, created_at, last_activity, answered_at)
        VALUES (?, 'deploy probe', 'probe', 'normal', NULL, 'mcp', 'active', ?, ?, ?)`,
  args: [callId, now, now, now],
});
await db.execute({
  sql: "INSERT INTO call_events (call_id, kind, text, meta, created_at) VALUES (?, 'agent_update', ?, NULL, ?)",
  args: [callId, "بروب نشر الاختبار — لو سامع الجملة دي النشر تمام.", now],
});
console.log("probe call:", callId);

async function markerTurn() {
  const res = await fetch(`${APP}/api/llm/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deploy-probe",
      stream: true,
      messages: [{ role: "user", content: "__NDAA_AGENT_UPDATE__" }],
      fishaudio_extra_body: { call_id: callId },
    }),
  });
  const raw = await res.text();
  let out = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    try {
      const j = JSON.parse(line.slice(6));
      for (const ch of j.choices ?? []) out += ch.delta?.content ?? "";
    } catch { /* ignore */ }
  }
  return { status: res.status, text: out };
}

const first = await markerTurn();
console.log("marker #1 →", JSON.stringify(first.status), JSON.stringify(first.text.slice(0, 60)));
const second = await markerTurn();
console.log("marker #2 →", JSON.stringify(second.status), JSON.stringify(second.text.slice(0, 60)));

const deployedNew = first.text.includes("رد الإيجنت") && second.text.trim() === "";
console.log(deployedNew
  ? "RESULT: NEW CODE LIVE ✓ (first speaks the reply, second stays silent)"
  : second.text.includes("لسه مفيش")
    ? "RESULT: OLD CODE STILL LIVE ✗ (the dead line is still there)"
    : "RESULT: UNKNOWN behavior — inspect above");

// cleanup
await db.execute({ sql: "DELETE FROM call_events WHERE call_id = ?", args: [callId] });
await db.execute({ sql: "DELETE FROM calls WHERE id = ?", args: [callId] });
console.log("probe rows cleaned up");
process.exit(deployedNew ? 0 : 2);
