import { FISH_API_BASE } from "./env";
import { getFishConfig } from "./settings";

/** Thin REST client for the Fish Audio Voice Agents API. */
async function fish(path: string, init?: RequestInit): Promise<Response> {
  const { api_key } = await getFishConfig();
  if (!api_key) throw new Error("FISH_API_KEY is not set — add it in the app settings");
  return fetch(`${FISH_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${api_key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** Resolve the voice agent id (DB setting, env fallback). */
export async function agentId(): Promise<string> {
  const { agent_id } = await getFishConfig();
  if (!agent_id) throw new Error("FISH_AGENT_ID is not set — add it in the app settings");
  return agent_id;
}

/** Build the spoken opener for a call: the agent reads the task summary first. */
export function buildFirstMessage(title: string, summary: string): string {
  const clean = summary.replace(/\s+/g, " ").trim();
  const t = title?.trim();
  const head = t ? `مهمة «${t}» خلصت.` : "المهمة خلصت.";
  return `${head}\n\n${clean}\n\nده ملخص اللي حصل. لو عايز تفاصيل أكتر أو عندك أي طلب، قولي وأنا معاك.`;
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
 * Create a Fish voice session for one call. `llm_extra_body.call_id` rides
 * every custom-LLM request back to us, and `overrides.first_message` makes
 * the agent open the call by reading the summary verbatim.
 */
export async function createVoiceSession(callId: string, title: string, summary: string): Promise<FishSessionResponse> {
  const res = await fish("/v1/agent/sessions", {
    method: "POST",
    body: JSON.stringify({
      agent_id: await agentId(),
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
export async function endVoiceSession(sessionId: string): Promise<void> {
  try {
    await fish(`/v1/agent/sessions/${sessionId}/end`, { method: "POST" });
  } catch {
    // best effort — the webhook is the reliable fallback
  }
}

/** GET the session record (transcript, status). */
export async function getFishSession(sessionId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fish(`/v1/agent/sessions/${encodeURIComponent(sessionId)}`);
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

export async function getAgentInfo(): Promise<FishAgentInfo | null> {
  try {
    const res = await fish(`/v1/agent/agents/${await agentId()}`);
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    return {
      agent_id: body.agent_id as string,
      name: body.name as string,
      status: body.status as string,
      publication_state: body.publication_state as string,
    };
  } catch {
    return null;
  }
}

/** PATCH agent config (draft). Used by the one-click "link Fish" admin action. */
export async function patchAgentConfig(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fish(`/v1/agent/agents/${await agentId()}/config`, { method: "PATCH", body: JSON.stringify(patch) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Fish config patch failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

/** Publish the agent draft so new sessions pick up the config. */
export async function publishAgent(): Promise<Record<string, unknown>> {
  const res = await fish(`/v1/agent/agents/${await agentId()}/publish`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Fish publish failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

/** Bind the Twilio phone number to the agent (inbound phone calls). */
export async function bindPhoneNumber(phoneNumberId: string): Promise<Record<string, unknown>> {
  const res = await fish(`/v1/agent/phone-numbers/${phoneNumberId}`, {
    method: "PATCH",
    body: JSON.stringify({ agent_id: await agentId() }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Phone bind failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}
