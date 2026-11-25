#!/usr/bin/env node
/**
 * Nidaa — Fish Audio post-deploy setup.
 *
 * Links the "hussain" voice agent to this deployment:
 *   1) Custom LLM  -> https://<app>/api/llm/v1 (the MCP voice bridge)
 *   2) Webhooks    -> https://<app>/api/fish/webhook (call.ended / call.analyzed)
 *   3) Arabic persona system prompt + platform-model fallback
 *   4) Publishes the agent draft
 *   5) Optionally binds the Twilio number to the agent (inbound phone calls)
 *
 * Usage:
 *   node scripts/setup-fish.mjs https://your-app.vercel.app
 *   node scripts/setup-fish.mjs https://your-app.vercel.app --no-phone   (skip binding)
 *
 * Env (or scripts/.secrets.env, or the app's Turso settings table):
 *   FISH_API_KEY, FISH_AGENT_ID, FISH_PHONE_NUMBER_ID,
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, AGENT_API_KEY (optional override)
 * Fish credentials saved from the app ("إعدادات Fish Audio" card) are read
 * from Turso automatically when the env vars are missing.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

const APP_URL = process.argv[2]?.replace(/\/+$/, "");
if (!APP_URL || !/^https?:\/\//.test(APP_URL)) {
  console.error("Usage: node scripts/setup-fish.mjs https://your-app.vercel.app [--no-phone]");
  process.exit(1);
}
const BIND_PHONE = !process.argv.includes("--no-phone");

// load secrets
if (existsSync("scripts/.secrets.env")) {
  for (const line of readFileSync("scripts/.secrets.env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
if (existsSync(".env") && !process.env.FISH_API_KEY) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const FISH_API_KEY = process.env.FISH_API_KEY;
const FISH_AGENT_ID = process.env.FISH_AGENT_ID;
const PHONE_ID = process.env.FISH_PHONE_NUMBER_ID;

// Fish credentials can live in the Turso settings table (saved from the app's
// "إعدادات Fish Audio" card) — fall back to them when not in the environment.
let DB_FISH = null;
if ((!FISH_API_KEY || !FISH_AGENT_ID) && process.env.TURSO_DATABASE_URL) {
  try {
    const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    const rs = await db.execute(
      "SELECT key, value FROM settings WHERE key IN ('fish_api_key','fish_agent_id','fish_phone_number_id')",
    );
    DB_FISH = Object.fromEntries(rs.rows.map((r) => [r.key, r.value]));
  } catch (err) {
    console.warn("[!] could not read Fish settings from Turso:", err.message);
  }
}

const API_KEY = FISH_API_KEY || DB_FISH?.fish_api_key;
const AGENT_ID = FISH_AGENT_ID || DB_FISH?.fish_agent_id;
const BIND_PHONE_ID = PHONE_ID || DB_FISH?.fish_phone_number_id || "ab10a45646d84f1f8d31aacf359de261";
if (!API_KEY || !AGENT_ID) {
  console.error("Missing FISH_API_KEY / FISH_AGENT_ID (env or app settings in Turso)");
  process.exit(1);
}

const FISH = "https://api.fish.audio";

async function fish(path, init) {
  const res = await fetch(`${FISH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

// Use the SAME agent API key the deployed app uses (auto-generated in Turso settings)
async function getAgentApiKey() {
  if (process.env.AGENT_API_KEY) return process.env.AGENT_API_KEY;
  if (!process.env.TURSO_DATABASE_URL) return null;
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  await db.execute(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const rs = await db.execute("SELECT value FROM settings WHERE key = 'agent_api_key'");
  return rs.rows[0]?.value ?? null;
}

const SYSTEM_PROMPT = `إنت «نداء»، مساعد صوتي عربي شخصي. بتتكلمي عربي مصري ببساطة ووضوح، وردودك قصيرة ومناسبة للصوت.
بقيت وكيل صوتي جوه تطبيق «نداء»: بتصلي على صاحبك لما المهمة المجدولة تخلص، بتقرا الملخص، وبستنى أسئلته وطلباته وتنفذيها فورًا.
لو مفيش إيجنت متواصل بالجلسة، ساعتها إنت نفسك المساعد: رد على الأسئلة بشكل طبيعي ومختصر.
متستخدمش كلمات إنجليزي غير الضروري. متقفلش المكالمة من نفسك — المستخدم بس اللي يقفل.`;

async function main() {
  console.log(`\nNidaa — Fish Audio setup`);
  console.log(`App URL : ${APP_URL}`);
  console.log(`Agent   : ${AGENT_ID}`);

  const agentKey = await getAgentApiKey();
  if (!agentKey) {
    console.error("Could not resolve AGENT_API_KEY (set it as env, or run once so the app stores it in Turso).");
    process.exit(1);
  }
  console.log(`API key : ${agentKey.slice(0, 14)}…`);

  // 1) custom LLM bridge
  console.log("\n[1/5] Custom LLM →", `${APP_URL}/api/llm/v1`);
  await fish(`/v1/agent/agents/${AGENT_ID}/config`, {
    method: "PATCH",
    body: JSON.stringify({
      llm: {
        custom: {
          base_url: `${APP_URL}/api/llm/v1`,
          model: "nidaa-bridge",
          api_key: agentKey,
        },
        fallback: { mode: "manual", models: [{ model: "openai/gpt-6.1-sol-fast" }] },
      },
    }),
  });

  // 2) conversation behavior for clean MCP bridging
  try {
    await fish(`/v1/agent/agents/${AGENT_ID}/config`, {
      method: "PATCH",
      body: JSON.stringify({
        conversation: { speculative_response: false, hangup_after_seconds: 600 },
      }),
    });
    console.log("[2/5] Conversation: speculative_response=false, idle hangup=600s");
  } catch (e) {
    console.log("[2/5] Conversation patch partial:", e.message);
  }

  // 3) system prompt
  await fish(`/v1/agent/agents/${AGENT_ID}/config`, {
    method: "PATCH",
    body: JSON.stringify({ prompt: { system_prompt: SYSTEM_PROMPT } }),
  });
  console.log("[3/5] Arabic system prompt set");

  // 4) webhooks (with a stable secret: derive from the agent key)
  const secret = `nidaa_${agentKey.slice(-32)}`;
  await fish(`/v1/agent/agents/${AGENT_ID}/config`, {
    method: "PATCH",
    body: JSON.stringify({
      webhooks: { post_call: [{ url: `${APP_URL}/api/fish/webhook`, secret }] },
    }),
  });
  console.log("[4/5] Webhook →", `${APP_URL}/api/fish/webhook`);

  // 5) publish
  const pub = await fish(`/v1/agent/agents/${AGENT_ID}/publish`, { method: "POST" });
  console.log("[5/5] Published:", JSON.stringify(pub).slice(0, 120));

  // 6) bind phone number
  if (BIND_PHONE && BIND_PHONE_ID) {
    try {
      const bound = await fish(`/v1/agent/phone-numbers/${BIND_PHONE_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ agent_id: AGENT_ID }),
      });
      console.log(`[+] Phone bound: ${bound.phone_number ?? BIND_PHONE_ID} → agent ${AGENT_ID}`);
    } catch (e) {
      console.log("[!] Phone bind failed:", e.message);
    }
  }

  console.log(`\nDone ✓  — inbound calls to your Twilio number now reach this agent, and every`);
  console.log(`        web call bridges the MCP loop (wait_for_call_updates ↔ send_call_update).`);
  console.log(`        NOTE: webhook secret is derived from the agent key, so if you pin a new`);
  console.log(`        AGENT_API_KEY env later, re-run this script.\n`);
}

main().catch((e) => {
  console.error("Setup failed:", e.message);
  process.exit(1);
});
