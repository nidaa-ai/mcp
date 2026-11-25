#!/usr/bin/env node
/**
 * Nidaa — post-deploy smoke test.
 * Verifies the deployed app end-to-end at the API level:
 * MCP handshake, notify -> poll -> update -> REST -> device channel.
 *
 * Usage: node scripts/smoke-test.mjs https://your-app.vercel.app
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

const APP = process.argv[2]?.replace(/\/+$/, "");
if (!APP) {
  console.error("Usage: node scripts/smoke-test.mjs https://your-app.vercel.app");
  process.exit(1);
}
if (existsSync("scripts/.secrets.env")) {
  for (const line of readFileSync("scripts/.secrets.env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
if (existsSync(".env") && !process.env.TURSO_DATABASE_URL) {
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

async function main() {
  console.log(`\nNidaa smoke test → ${APP}\n`);

  const key = await getAgentKey();
  check("resolve AGENT_API_KEY", !!key, key ? `${key.slice(0, 12)}…` : "not found in Turso settings");
  if (!key) process.exit(1);

  const home = await fetch(APP);
  check("GET / responds 200", home.ok, `status ${home.status}`);

  const init = await mcp(key, "initialize", { protocolVersion: "2025-06-18" });
  check("MCP initialize", !!init.result?.serverInfo, init.result?.serverInfo?.name ?? JSON.stringify(init).slice(0, 120));

  const tools = await mcp(key, "tools/list");
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  check(
    "MCP tools present",
    ["notify_task_complete", "wait_for_call_updates", "send_call_update"].every((t) => names.includes(t)),
    names.join(", "),
  );

  const call = await mcp(key, "tools/call", {
    name: "notify_task_complete",
    arguments: { summary: "smoke test: نسمة نظام", title: "اختبار تلقائي" },
  });
  const payload = JSON.parse(call.result?.content?.[0]?.text ?? "{}");
  check("notify_task_complete", !!payload.call_id, `call ${payload.call_id} (${payload.status})`);
  check("notify → loop directive", payload.directive?.startsWith("CALL_STARTED") === true && payload.keep_looping === true);

  const wait = await mcp(key, "tools/call", {
    name: "wait_for_call_updates",
    arguments: { call_id: payload.call_id, wait_seconds: 2 },
  });
  const waitPayload = JSON.parse(wait.result?.content?.[0]?.text ?? "{}");
  check("wait_for_call_updates", waitPayload.call_id === payload.call_id, `status ${waitPayload.status}, ${waitPayload.updates?.length ?? 0} updates`);
  check("wait → keep-alive directive", typeof waitPayload.directive === "string" && waitPayload.keep_looping === true, (waitPayload.directive ?? "").slice(0, 60));

  const upd = await mcp(key, "tools/call", {
    name: "send_call_update",
    arguments: { call_id: payload.call_id, message: "smoke update" },
  });
  const updPayload = JSON.parse(upd.result?.content?.[0]?.text ?? "{}");
  check("send_call_update", updPayload.ok === true, `seq ${updPayload.seq}`);
  check("send → stay-on-line directive", updPayload.directive?.startsWith("SPOKEN_LIVE") === true && updPayload.keep_looping === true);

  const rest = await fetch(`${APP}/api/calls/${payload.call_id}/updates?since=0`, {
    headers: { Authorization: `Bearer ${key}` },
  }).then((r) => r.json());
  check("REST poll updates", Array.isArray(rest.updates) && rest.updates.length > 0, `${rest.updates?.length ?? 0} events`);

  // LLM bridge (what Fish's custom LLM gets)
  const llm = await fetch(`${APP}/api/llm/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "smoke",
      stream: true,
      messages: [{ role: "user", content: "__NDAA_AGENT_UPDATE__" }],
      fishaudio_extra_body: { call_id: payload.call_id },
    }),
  });
  const llmText = await llm.text();
  check("LLM bridge marker turn", llm.ok && llmText.includes("data: "), `status ${llm.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "ALL CHECKS PASSED ✓" : `${failed.length} CHECKS FAILED ✗`}\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke test crashed:", e);
  process.exit(1);
});
