import { NextRequest } from "next/server";
import { getAgentApiKey } from "./settings";
import { NIDAA_ALLOWED_EMAILS } from "./env";
import { db, ensureSchema } from "./db";
import { getUserByApiKey } from "./users";

export type ApiError = { error: string };

/**
 * Auth context for the MCP endpoint and the REST API. email = the owning
 * account when the key belongs to a user (multi-tenant), or null for the
 * legacy global key (pre-migration / env-pinned deployments).
 */
export interface AgentContext {
  email: string | null;
}

/** Extract the raw API key from Bearer / ?key= / x-api-key. */
function extractKey(req: NextRequest): string {
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const url = new URL(req.url);
  return url.searchParams.get("key") ?? req.headers.get("x-api-key") ?? "";
}

/**
 * Resolve the request's API key to a user context:
 *  1. a user's own agent_api_key → that user (calls/push scoped to them),
 *  2. the legacy global key → null-email legacy context (old behavior),
 *  3. anything else → null (unauthorized).
 */
export async function resolveAgentAuth(req: NextRequest): Promise<AgentContext | null> {
  const key = extractKey(req);
  if (!key) return null;
  const user = await getUserByApiKey(key);
  if (user) return { email: user.email };
  const globalKey = await getAgentApiKey();
  if (key.toLowerCase() === globalKey.toLowerCase()) return { email: null };
  return null;
}

/** Auth used by the MCP endpoint and the REST API (and Fish custom LLM). */
export async function checkAgentAuth(req: NextRequest): Promise<boolean> {
  return (await resolveAgentAuth(req)) !== null;
}

export function unauthorized() {
  return Response.json({ error: "unauthorized: provide Authorization: Bearer <AGENT_API_KEY> or ?key=" }, { status: 401 });
}

/** Device token for the phone web app (issued after entering the access code). */
export function checkDeviceToken(req: NextRequest): string | null {
  const token = req.headers.get("x-device-token") ?? new URL(req.url).searchParams.get("token");
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return null;
  return token;
}

/** Format + DB existence check for device tokens. */
export async function isValidDevice(token: string | null): Promise<boolean> {
  if (!token) return false;
  await ensureSchema();
  const rs = await db.execute({ sql: "SELECT id FROM devices WHERE id = ?", args: [token] });
  return rs.rows.length > 0;
}

/** Normalize an email/username typed into the login screen. */
export function normalizeLoginEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Optional email whitelist (NIDAA_ALLOWED_EMAILS). Empty = allow anyone. */
export function emailAllowed(email: string): boolean {
  const list = NIDAA_ALLOWED_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  return list.includes(email);
}

export function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
