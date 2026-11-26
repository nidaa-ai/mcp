#!/usr/bin/env node
/** Print the full role+content conversation from Fish sessions. */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

for (const sid of process.argv.slice(2)) {
  console.log(`\n=========== SESSION ${sid} ===========`);
  const res = await fetch(`https://api.fish.audio/v1/agent/sessions/${encodeURIComponent(sid)}`, {
    headers: { Authorization: `Bearer ${process.env.FISH_API_KEY}` },
  });
  if (!res.ok) {
    console.log("  HTTP", res.status);
    continue;
  }
  const body = await res.json();
  console.log("  end_reason:", body.end_reason, "| llm_endpoint_errors:", (body.llm_endpoint_errors ?? []).length, "| llm_fallbacks:", (body.llm_fallbacks ?? []).length, "| engine_fallbacks:", (body.engine_fallbacks ?? []).length);
  for (const f of body.llm_fallbacks ?? []) console.log("   llm_fallback:", JSON.stringify(f).slice(0, 300));
  for (const f of body.engine_fallbacks ?? []) console.log("   engine_fallback:", JSON.stringify(f).slice(0, 300));
  const items = body.items ?? [];
  for (const it of items) {
    if (it.type !== "message") {
      console.log(`  [${it.type}]`, JSON.stringify(it).slice(0, 200));
      continue;
    }
    const content = typeof it.content === "string" ? it.content : JSON.stringify(it.content);
    const who = it.role === "user" ? "USER" : "AGENT";
    const gen = it.llm_usage?.billing_mode ? ` (billing=${it.llm_usage.billing_mode}, calls=${it.llm_usage.call_count})` : "";
    const fb = it.fallback_reason ? ` FALLBACK_REASON=${it.fallback_reason}` : "";
    const abm = it.answered_by_model ? ` answered_by=${it.answered_by_model}` : "";
    const time = (it.created_at ?? "").slice(11, 19);
    const text = String(content).replace(/\s+/g, " ").slice(0, 220);
    console.log(`  ${time} ${who}: ${text}${gen}${fb}${abm}`);
  }
}
