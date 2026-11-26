#!/usr/bin/env node
/** Push the new relay system prompt to the Fish agent and publish it. */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

// Extract AGENT_SYSTEM_PROMPT verbatim from the route source.
const src = readFileSync("src/app/api/admin/fish-link/route.ts", "utf8");
const match = src.match(/const AGENT_SYSTEM_PROMPT = `([\s\S]*?)`;\n/);
if (!match) {
  console.error("could not extract AGENT_SYSTEM_PROMPT from source");
  process.exit(1);
}
const prompt = match[1];

const agentId = process.env.FISH_AGENT_ID;
const auth = { Authorization: `Bearer ${process.env.FISH_API_KEY}`, "Content-Type": "application/json" };

// 1) patch the draft prompt
const patch = await fetch(`https://api.fish.audio/v1/agent/agents/${agentId}/config`, {
  method: "PATCH",
  headers: auth,
  body: JSON.stringify({ prompt: { system_prompt: prompt } }),
});
console.log("PATCH /config →", patch.status);
if (!patch.ok) {
  console.log(await patch.text());
  process.exit(1);
}

// 2) publish so new sessions use it
const pub = await fetch(`https://api.fish.audio/v1/agent/agents/${agentId}/publish`, {
  method: "POST",
  headers: auth,
});
console.log("POST /publish →", pub.status, (await pub.text()).slice(0, 200));

// 3) verify
const cfg = await (await fetch(`https://api.fish.audio/v1/agent/agents/${agentId}/config`, {
  headers: auth,
})).json();
const now = cfg?.prompt?.system_prompt ?? "";
console.log("verify marker-ignore line:", now.includes("__NDAA_AGENT_UPDATE__"));
console.log("verify relay framing:", now.includes("وسيط صوتي"));
console.log("verify no self-assistant line:", !now.includes("ساعتها إنت نفسك المساعد"));
