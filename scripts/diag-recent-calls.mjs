#!/usr/bin/env node
/** Diagnose the user's real calls: recent calls + events + spoken flags. */
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const calls = await db.execute("SELECT * FROM calls ORDER BY created_at DESC LIMIT 5");
for (const c of calls.rows) {
  const call = c;
  console.log("\n=== CALL", call.id, "===");
  console.log("  title:", call.title, "| status:", call.status, "| source:", call.source);
  console.log("  created:", new Date(Number(call.created_at)).toISOString(), "| ended:", call.ended_at ? new Date(Number(call.ended_at)).toISOString() : "-", "| ended_by:", call.ended_by);
  console.log("  fish_session_id:", call.fish_session_id);
  const evs = await db.execute({
    sql: "SELECT * FROM call_events WHERE call_id = ? ORDER BY seq ASC",
    args: [call.id],
  });
  for (const e of evs.rows) {
    const txt = String(e.text ?? "").replace(/\s+/g, " ").slice(0, 90);
    console.log(`   [${e.kind}] spoken=${e.spoken} seq=${e.seq} ${new Date(Number(e.created_at)).toISOString()} :: ${txt}`);
  }
}
