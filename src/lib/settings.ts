import { randomBytes } from "crypto";
import { db, ensureSchema } from "./db";
import {
  AGENT_API_KEY_ENV,
  FISH_WEBHOOK_SECRET_ENV,
  VAPID_PUBLIC_KEY_ENV,
  VAPID_PRIVATE_KEY_ENV,
  FISH_API_KEY_ENV,
  FISH_AGENT_ID_ENV,
  FISH_PHONE_NUMBER_ID_ENV,
} from "./env";

/** getSetting / setSetting on the settings kv table. */
export async function getSetting(key: string): Promise<string | null> {
  await ensureSchema();
  const rs = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  return rs.rows[0]?.value as string | undefined ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}

/** Read an auto-generated value or create + persist it. */
async function getOrGenerate(key: string, generator: () => string): Promise<string> {
  const existing = await getSetting(key);
  if (existing) return existing;
  const fresh = generator();
  await setSetting(key, fresh);
  return fresh;
}

/**
 * The API key used by: the MCP endpoint, the REST API, and the Fish Audio
 * custom-LLM endpoint. Set AGENT_API_KEY in the environment to pin it,
 * otherwise a key is generated on first use and shown inside the app.
 */
export async function getAgentApiKey(): Promise<string> {
  if (AGENT_API_KEY_ENV) return AGENT_API_KEY_ENV;
  return getOrGenerate("agent_api_key", () => `nidaa_${randomBytes(24).toString("hex")}`);
}

/**
 * Shared secret used to verify Fish Audio webhooks.
 * Derived deterministically from the agent API key (env override wins), so the
 * setup script and the app always agree without extra state.
 */
export async function getFishWebhookSecret(): Promise<string> {
  if (FISH_WEBHOOK_SECRET_ENV) return FISH_WEBHOOK_SECRET_ENV;
  const key = await getAgentApiKey();
  return `nidaa_${key.slice(-32)}`;
}

/** Web-push VAPID keypair. */
export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (VAPID_PUBLIC_KEY_ENV && VAPID_PRIVATE_KEY_ENV) {
    return { publicKey: VAPID_PUBLIC_KEY_ENV, privateKey: VAPID_PRIVATE_KEY_ENV };
  }
  const existingPub = await getSetting("vapid_public_key");
  const existingPriv = await getSetting("vapid_private_key");
  if (existingPub && existingPriv) return { publicKey: existingPub, privateKey: existingPriv };
  const webpush = await import("web-push");
  const keys = webpush.generateVAPIDKeys();
  await setSetting("vapid_public_key", keys.publicKey);
  await setSetting("vapid_private_key", keys.privateKey);
  return keys;
}

/* ---------------------------------------------------- Fish credentials ---- */

export interface FishConfig {
  api_key: string;
  agent_id: string;
  phone_number_id: string;
}

/** True when the stored/env value is usable (not blank). */
function pick(stored: string | null, fallback: string): string {
  const v = (stored ?? "").trim();
  return v || fallback;
}

/**
 * Fish Audio credentials. The values saved from inside the app (Turso
 * settings table) win; the env vars are only a bootstrap fallback.
 */
export async function getFishConfig(): Promise<FishConfig> {
  const [key, agent, phone] = await Promise.all([
    getSetting("fish_api_key"),
    getSetting("fish_agent_id"),
    getSetting("fish_phone_number_id"),
  ]);
  return {
    api_key: pick(key, FISH_API_KEY_ENV),
    agent_id: pick(agent, FISH_AGENT_ID_ENV),
    phone_number_id: pick(phone, FISH_PHONE_NUMBER_ID_ENV),
  };
}

/** Mask a secret for display: keeps a short head + tail only. */
export function maskSecret(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length <= 12) return `${v.slice(0, 2)}…`;
  return `${v.slice(0, 8)}…${v.slice(-4)}`;
}

/** Persist Fish credentials entered in the app (partial update, DB wins). */
export async function saveFishConfig(input: {
  fish_api_key?: unknown;
  fish_agent_id?: unknown;
  fish_phone_number_id?: unknown;
}): Promise<void> {
  await ensureSchema();
  const writes: Array<[string, string]> = [];
  if (typeof input.fish_api_key === "string" && input.fish_api_key.trim()) {
    writes.push(["fish_api_key", input.fish_api_key.trim()]);
  }
  if (typeof input.fish_agent_id === "string" && input.fish_agent_id.trim()) {
    writes.push(["fish_agent_id", input.fish_agent_id.trim()]);
  }
  if (typeof input.fish_phone_number_id === "string" && input.fish_phone_number_id.trim()) {
    writes.push(["fish_phone_number_id", input.fish_phone_number_id.trim()]);
  }
  for (const [key, value] of writes) await setSetting(key, value);
}
