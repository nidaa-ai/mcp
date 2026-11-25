#!/usr/bin/env node
/** Query Fish Audio sessions API for the real transcript + llm_endpoint_errors. */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const sessions = process.argv.slice(2);
if (!sessions.length) {
  console.error("Usage: node scripts/diag-fish-session.mjs <session_id>...");
  process.exit(1);
}

for (const sid of sessions) {
  console.log(`\n=========== SESSION ${sid} ===========`);
  const res = await fetch(`https://api.fish.audio/v1/agent/sessions/${encodeURIComponent(sid)}`, {
    headers: { Authorization: `Bearer ${process.env.FISH_API_KEY}` },
  });
  if (!res.ok) {
    console.log("  HTTP", res.status, await res.text().catch(() => ""));
    continue;
  }
  const body = await res.json();
  const keys = Object.keys(body);
  console.log("  top-level keys:", keys.join(", "));
  for (const k of ["status", "end_reason", "created_at", "ended_at"]) {
    if (body[k] !== undefined) console.log(`  ${k}:`, body[k]);
  }
  if (Array.isArray(body.llm_endpoint_errors)) {
    console.log(`  llm_endpoint_errors (${body.llm_endpoint_errors.length}):`);
    for (const e of body.llm_endpoint_errors) {
      console.log("   ", JSON.stringify(e).slice(0, 500));
    }
  }
  // transcripts may live under different keys
  for (const k of ["transcript", "messages", "items", "conversation", "history"]) {
    if (Array.isArray(body[k]) && body[k].length) {
      console.log(`  ${k} (${body[k].length} entries):`);
      for (const t of body[k]) {
        console.log("   ", JSON.stringify(t).slice(0, 400));
      }
    }
  }
}
