import { randomBytes } from "crypto";
import { db, ensureSchema } from "./db";
import type { FishConfig } from "./settings";

/**
 * Per-user account data: each signed-in user brings their OWN Fish Audio
 * credentials and gets their OWN agent API key (MCP/REST). Nothing is shared
 * between accounts — calls, push notifications and SSE events are all scoped
 * to the owning user.
 */

export interface UserRow {
  email: string;
  agent_api_key: string | null;
  fish_api_key: string | null;
  fish_agent_id: string | null;
  fish_phone_number_id: string | null;
}

function toUser(row: Record<string, unknown>): UserRow {
  return {
    email: row.email as string,
    agent_api_key: (row.agent_api_key as string | null) ?? null,
    fish_api_key: (row.fish_api_key as string | null) ?? null,
    fish_agent_id: (row.fish_agent_id as string | null) ?? null,
    fish_phone_number_id: (row.fish_phone_number_id as string | null) ?? null,
  };
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  await ensureSchema();
  const rs = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });
  const row = rs.rows[0];
  return row ? toUser(row as unknown as Record<string, unknown>) : null;
}

/** Resolve an MCP/REST API key to its owning user (multi-tenant auth). */
export async function getUserByApiKey(key: string): Promise<UserRow | null> {
  if (!key) return null;
  await ensureSchema();
  const rs = await db.execute({ sql: "SELECT * FROM users WHERE agent_api_key = ?", args: [key] });
  const row = rs.rows[0];
  return row ? toUser(row as unknown as Record<string, unknown>) : null;
}

/** The account a device token belongs to. */
export async function deviceEmail(token: string): Promise<string | null> {
  await ensureSchema();
  const rs = await db.execute({ sql: "SELECT user_email FROM devices WHERE id = ?", args: [token] });
  return (rs.rows[0]?.user_email as string | null) ?? null;
}

/** Read the user's agent API key or generate + persist a fresh one. */
export async function ensureUserApiKey(email: string): Promise<string> {
  const user = await getUserByEmail(email);
  if (user?.agent_api_key) return user.agent_api_key;
  const fresh = `nidaa_${randomBytes(24).toString("hex")}`;
  await db.execute({
    sql: "UPDATE users SET agent_api_key = ? WHERE email = ?",
    args: [fresh, email],
  });
  return fresh;
}

/** The user's Fish credentials — their OWN values only, never another account's. */
export async function getUserFishConfig(email: string | null): Promise<FishConfig> {
  if (!email) return { api_key: "", agent_id: "", phone_number_id: "" };
  const user = await getUserByEmail(email);
  return {
    api_key: user?.fish_api_key ?? "",
    agent_id: user?.fish_agent_id ?? "",
    phone_number_id: user?.fish_phone_number_id ?? "",
  };
}

/** Persist Fish credentials for ONE account (partial update). */
export async function saveUserFishConfig(
  email: string,
  input: { fish_api_key?: unknown; fish_agent_id?: unknown; fish_phone_number_id?: unknown },
): Promise<void> {
  await ensureSchema();
  const sets: string[] = [];
  const args: Array<string> = [];
  if (typeof input.fish_api_key === "string" && input.fish_api_key.trim()) {
    sets.push("fish_api_key = ?");
    args.push(input.fish_api_key.trim());
  }
  if (typeof input.fish_agent_id === "string" && input.fish_agent_id.trim()) {
    sets.push("fish_agent_id = ?");
    args.push(input.fish_agent_id.trim());
  }
  if (typeof input.fish_phone_number_id === "string" && input.fish_phone_number_id.trim()) {
    sets.push("fish_phone_number_id = ?");
    args.push(input.fish_phone_number_id.trim());
  }
  if (!sets.length) return;
  await db.execute({ sql: `UPDATE users SET ${sets.join(", ")} WHERE email = ?`, args: [...args, email] });
}

/**
 * Fish credentials to open a voice session for a given call: the OWNER's
 * config when the call belongs to a user (strict — no cross-account
 * fallback), the legacy global config for pre-migration ownerless calls.
 */
export async function fishConfigForCall(call: { user_email: string | null }): Promise<FishConfig> {
  if (call.user_email) return getUserFishConfig(call.user_email);
  const { getFishConfig } = await import("./settings");
  return getFishConfig();
}

/** Webhook secret derived from an agent API key (same scheme as the global one). */
export function webhookSecretFor(agentKey: string): string {
  return `nidaa_${agentKey.slice(-32)}`;
}
