import { FISH_API_BASE } from "./env";
import type { FishConfig } from "./settings";

/**
 * Thin REST client for the Fish Audio Voice Agents API.
 * Every function takes an EXPLICIT FishConfig — the credentials of the user
 * who owns the call/agent (multi-tenant: no shared global key).
 */

async function fish(path: string, cfg: FishConfig, init?: RequestInit): Promise<Response> {
  if (!cfg.api_key) throw new Error("FISH_API_KEY is not set — add it in the app settings");
  return fetch(`${FISH_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.api_key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function requireAgentId(cfg: FishConfig): string {
  if (!cfg.agent_id) throw new Error("FISH_AGENT_ID is not set — add it in the app settings");
  return cfg.agent_id;
}

/**
 * Build the spoken opener: natural live-call opening (no "relay/intermediary"
 * framing), then reads the AGENT's reply verbatim, then one short line that
 * sets the live expectation: anything you say reaches the agent, and the
 * agent's reply is spoken the moment it lands.
 */
export function buildFirstMessage(title: string, summary: string): string {
  const clean = summary.replace(/\s+/g, " ").trim();
  const t = title?.trim();
  const head = t ? `مهمة «${t}» خلصت.` : "المهمة خلصت.";
  return (
    `ألو؟ معاك نداء.\n\n` +
    `${head}\n\n` +
    `رد الإيجنت: ${clean}\n\n` +
    `اتكلم عادي — أي حاجة تقولها بتوصل للإيجنت فورًا وهو بينفذها معاك، وأول ما يرد أقولك رده هنا.`
  );
}

export interface FishSessionResponse {
  session_id: string;
  expires_at: string;
  max_duration_seconds: number;
  transport: string;
  livekit_url?: string;
  token?: string;
  [key: string]: unknown;
}

/**
 * Create a Fish voice session for one call, with the CALL OWNER's
 * credentials. `llm_extra_body.call_id` rides every custom-LLM request back
 * to us, and `overrides.first_message` makes the agent open the call by
 * reading the summary verbatim.
 */
export async function createVoiceSession(
  callId: string,
  title: string,
  summary: string,
  cfg: FishConfig,
): Promise<FishSessionResponse> {
  const res = await fish("/v1/agent/sessions", cfg, {
    method: "POST",
    body: JSON.stringify({
      agent_id: requireAgentId(cfg),
      end_user_id: "owner",
      metadata: { call_id: callId, app: "nidaa" },
      llm_extra_body: { call_id: callId },
      timezone: "Africa/Cairo",
      overrides: {
        first_message: buildFirstMessage(title, summary),
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Fish session creation failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body as FishSessionResponse;
}

/** Force-end a live Fish session (used when the user hangs up from the app). */
export async function endVoiceSession(sessionId: string, cfg: FishConfig): Promise<void> {
  if (!cfg.api_key) return; // nothing we can do without credentials
  try {
    await fish(`/v1/agent/sessions/${sessionId}/end`, cfg, { method: "POST" });
  } catch {
    // best effort — the webhook is the reliable fallback
  }
}

/** GET the session record (transcript, status). */
export async function getFishSession(sessionId: string, cfg: FishConfig): Promise<Record<string, unknown> | null> {
  try {
    const res = await fish(`/v1/agent/sessions/${encodeURIComponent(sessionId)}`, cfg);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface FishAgentInfo {
  agent_id: string;
  name: string;
  status: string;
  publication_state: string;
}

export async function getAgentInfo(cfg: FishConfig): Promise<FishAgentInfo | null> {
  if (!cfg.api_key || !cfg.agent_id) return null;
  try {
    const res = await fish(`/v1/agent/agents/${encodeURIComponent(cfg.agent_id)}`, cfg);
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    return {
      agent_id: (body.agent_id as string) ?? cfg.agent_id,
      name: body.name as string,
      status: body.status as string,
      publication_state: body.publication_state as string,
    };
  } catch {
    return null;
  }
}

/** PATCH agent config (draft). Used by the one-click "link Fish" action. */
export async function patchAgentConfig(
  patch: Record<string, unknown>,
  cfg: FishConfig,
): Promise<Record<string, unknown>> {
  const res = await fish(`/v1/agent/agents/${encodeURIComponent(requireAgentId(cfg))}/config`, cfg, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Fish config patch failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

/** Publish the agent draft so new sessions pick up the config. */
export async function publishAgent(cfg: FishConfig): Promise<Record<string, unknown>> {
  const res = await fish(`/v1/agent/agents/${encodeURIComponent(requireAgentId(cfg))}/publish`, cfg, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Fish publish failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

/** Bind the Twilio phone number to the agent (inbound phone calls). */
export async function bindPhoneNumber(phoneNumberId: string, cfg: FishConfig): Promise<Record<string, unknown>> {
  const res = await fish(`/v1/agent/phone-numbers/${encodeURIComponent(phoneNumberId)}`, cfg, {
    method: "PATCH",
    body: JSON.stringify({ agent_id: requireAgentId(cfg) }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Phone bind failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}
