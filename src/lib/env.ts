export const FISH_API_BASE = process.env.FISH_API_BASE ?? "https://api.fish.audio";
/**
 * Fish Audio credentials are managed IN THE APP (stored in the Turso settings
 * table) — these env vars are only an optional bootstrap fallback.
 */
export const FISH_API_KEY_ENV = process.env.FISH_API_KEY ?? "";
export const FISH_AGENT_ID_ENV = process.env.FISH_AGENT_ID ?? "";
export const FISH_PHONE_NUMBER_ID_ENV = process.env.FISH_PHONE_NUMBER_ID ?? "";
export const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL ?? "";
export const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN ?? "";
/**
 * Optional comma-separated whitelist of emails allowed to sign in.
 * Empty (default) = anyone with the link can sign in directly.
 * Example: NIDAA_ALLOWED_EMAILS="me@example.com,wife@example.com"
 */
export const NIDAA_ALLOWED_EMAILS = process.env.NIDAA_ALLOWED_EMAILS ?? "";
export const AGENT_API_KEY_ENV = process.env.AGENT_API_KEY ?? "";
export const FISH_WEBHOOK_SECRET_ENV = process.env.FISH_WEBHOOK_SECRET ?? "";
export const VAPID_PUBLIC_KEY_ENV = process.env.VAPID_PUBLIC_KEY ?? "";
export const VAPID_PRIVATE_KEY_ENV = process.env.VAPID_PRIVATE_KEY ?? "";

function numEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** How long the incoming call rings before it is marked as missed (ms). */
export const RING_TIMEOUT_MS = numEnv("RING_TIMEOUT_MS", 60_000);
/**
 * Grace window (ms) before a turn is delegated to Fish's own agent brain.
 * Keep it WELL under Fish's 10-second custom-LLM response cap — the agent's
 * real reply usually arrives later and is spoken via the browser's marker
 * injection, while the platform fallback model does the natural talking.
 */
export const LLM_BRIDGE_GRACE_MS = numEnv("LLM_BRIDGE_GRACE_MS", 1_200);
/** Default / max long-poll window for wait_for_call_updates (seconds).
 *  12s keeps the agent's view of the user's speech fresh (~6s average) so
 *  replies land inside the bridge's speak window and the call feels live. */
export const WAIT_DEFAULT_SECONDS = numEnv("WAIT_DEFAULT_SECONDS", 12);
export const WAIT_MAX_SECONDS = numEnv("WAIT_MAX_SECONDS", 55);
/**
 * Consider the MCP agent "following the call" if it polled within this window (ms).
 * Generous on purpose: while ChatGPT executes a long command (browsing, coding)
 * it does not poll, and the bridge must not fall back to the platform LLM
 * mid-execution — the late send_call_update is still spoken when it lands.
 */
export const AGENT_HEARTBEAT_MS = numEnv("AGENT_HEARTBEAT_MS", 150_000);
