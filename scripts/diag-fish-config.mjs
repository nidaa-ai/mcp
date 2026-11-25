#!/usr/bin/env node
/** Show the current Fish agent config: system prompt + llm settings. */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const agentId = process.env.FISH_AGENT_ID;
const res = await fetch(`https://api.fish.audio/v1/agent/agents/${agentId}/config`, {
  headers: { Authorization: `Bearer ${process.env.FISH_API_KEY}` },
});
console.log("GET /config →", res.status);
if (res.ok) {
  const cfg = await res.json();
  console.log("keys:", Object.keys(cfg).join(", "));
  const prompt = cfg?.prompt?.system_prompt ?? "";
  console.log("\n--- system_prompt (first 700 chars) ---");
  console.log(String(prompt).slice(0, 700));
  console.log("\nhas marker-ignore line:", prompt.includes("__NDAA_AGENT_UPDATE__"));
  console.log("llm:", JSON.stringify(cfg?.llm ?? null).slice(0, 300));
  console.log("conversation:", JSON.stringify(cfg?.conversation ?? null).slice(0, 200));
}
