import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { checkAgentAuth, unauthorized } from "@/lib/auth";
import { getCall, addEvent, claimAgentUpdates, isAgentFollowing, setCallFields, sleep, type CallRow } from "@/lib/calls";
import { LLM_BRIDGE_GRACE_MS } from "@/lib/env";
import { relayState, noteReplySpoken, happenedWithin } from "@/lib/relay-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * OpenAI-compatible chat-completions endpoint that Fish Audio's Voice Agent
 * (custom LLM) calls on every conversation turn.
 *
 * A STATEFUL ROUTER, not a talker. The natural talking is left to Fish's own
 * agent brain — the manual fallback model with the agent's system prompt
 * (relay role: never "I don't have access", never self-executing). This
 * endpoint only owns what the platform brain CANNOT know:
 *  - it logs every user utterance so wait_for_call_updates returns it to the
 *    connected agent as a live command,
 *  - it speaks the agent's send_call_update replies VERBATIM, framed as
 *    "رد الإيجنت: ..." (turn fast-path + the browser's marker injection),
 *  - for everything else it returns 503 after a ~1s grace window: Fish then
 *    routes the turn to the fallback brain, which acks naturally in its own
 *    words — varied, human, never the same sentence twice, never ours.
 *
 * CRITICAL timing note: Fish caps custom-LLM responses at 10 seconds and
 * retries once. The old 12-second wait here used to blow that cap, so Fish
 * fell back mid-wait with the OLD "you are the assistant" prompt — that is
 * where the self-answers and "معنديش وصول" came from. The grace window is
 * now ~1.2s; late agent replies are delivered by the marker injection.
 */
export const AGENT_UPDATE_MARKER = "__NDAA_AGENT_UPDATE__";

/**
 * Attribution is fixed on purpose: the caller must always know WHO answered.
 * The reply content is the agent's own — delivered verbatim, never rephrased.
 */
const AGENT_FRAME = "رد الإيجنت: ";
const CALL_ENDED_LINE = "المكالمة اتقفلت. مع السلامة.";
/** Whitespace-only turn: the voice channel stays silent. */
const SILENCE = " ";

const ENDED_STATUSES = ["ended", "missed", "declined", "failed"];

function sseChunk(id: string, model: string, delta: Record<string, unknown>, finish: string | null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

function sseResponse(text: string, model: string) {
  const id = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  chunks.push(sseChunk(id, model, { role: "assistant" }, null));
  // stream in small word groups so the platform sees a real token stream
  const group = Math.max(1, Math.ceil(words.length / 8));
  for (let i = 0; i < words.length; i += group) {
    const piece = words.slice(i, i + group).join("");
    if (piece) chunks.push(sseChunk(id, model, { content: piece }, null));
  }
  chunks.push(sseChunk(id, model, {}, "stop"));
  chunks.push(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  })}\n\n`);
  chunks.push("data: [DONE]\n\n");
  return new Response(chunks.join(""), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}

function joinClaimed(events: { text: string | null }[]): string {
  return events.map((e) => e.text ?? "").filter(Boolean).join("\n\n");
}

/** Hand the turn to Fish's own agent brain (manual fallback model). */
function delegateToPlatformBrain(fresh: CallRow | null, model: string) {
  if (!fresh || ENDED_STATUSES.includes(fresh.status)) {
    return sseResponse(CALL_ENDED_LINE, model);
  }
  const following = isAgentFollowing(fresh);
  return Response.json(
    {
      error: "delegated to the platform fallback model — natural relay speech per the agent system prompt",
      delegate: true,
      reason: following ? "agent_working" : "no_agent_connected",
      agent_following: following,
      grace_ms: LLM_BRIDGE_GRACE_MS,
    },
    { status: 503 },
  );
}

export async function POST(req: NextRequest) {
  if (!(await checkAgentAuth(req))) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const model = String(body.model ?? "nidaa-bridge");
  const messages = Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]) : [];
  const extra = (body.fishaudio_extra_body ?? {}) as Record<string, unknown>;
  const callId = typeof extra.call_id === "string" ? extra.call_id : null;

  if (!callId) {
    // Session without a Nidaa call mapping (e.g. a plain phone call to the
    // bound Twilio number): delegate to the platform brain for the whole call.
    return Response.json(
      { error: "no call_id mapping — delegated to the platform fallback model", delegate: true, reason: "unmapped_session" },
      { status: 503 },
    );
  }

  const call = await getCall(callId);
  if (!call) {
    return Response.json({ error: `unknown call_id ${callId}` }, { status: 503 });
  }

  // find the last user turn
  let lastUserIdx = -1;
  let lastUserText = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      lastUserText = String(messages[i].content ?? "");
      break;
    }
  }

  /* ---- case 1: the browser asks us to speak pending agent updates ---- */
  if (lastUserText.trim() === AGENT_UPDATE_MARKER) {
    const claimed = await claimAgentUpdates(callId);
    const text = joinClaimed(claimed);
    if (text) {
      noteReplySpoken(callId, claimed.map((e) => e.seq));
      return sseResponse(AGENT_FRAME + text, model);
    }
    // Nothing to claim: this injection raced with the turn fast-path and the
    // reply was ALREADY spoken. Stay silent — no "no reply yet" dead line.
    return sseResponse(SILENCE, model);
  }

  // No user turn at all (e.g. a session warm-up call): the opener is already
  // speaking from overrides.first_message — nothing to relay yet.
  if (lastUserIdx === -1) {
    return sseResponse(SILENCE, model);
  }

  /* ---- case 2: a real user utterance ---- */
  const hash = createHash("sha256").update(lastUserText).digest("hex").slice(0, 16);
  const isDuplicate = call.last_user_idx === lastUserIdx && call.last_user_hash === hash;
  if (!isDuplicate) {
    await addEvent(callId, "user_speech", lastUserText);
    await setCallFields(callId, { last_user_idx: lastUserIdx, last_user_hash: hash });
  }

  // Grace window: catch a reply that is already here or lands within ~1s
  // (e.g. the agent finished right as the user spoke). The claim is atomic,
  // so the browser's marker injection and this loop never double-speak.
  const st = relayState(callId);
  const startSpokenSeq = st.lastSpokenSeq;
  const deadline = Date.now() + LLM_BRIDGE_GRACE_MS;
  while (Date.now() < deadline) {
    const claimed = await claimAgentUpdates(callId);
    const text = joinClaimed(claimed);
    if (text) {
      noteReplySpoken(callId, claimed.map((e) => e.seq));
      return sseResponse(AGENT_FRAME + text, model);
    }
    // The marker turn won the race and just delivered the reply — stay quiet.
    if (st.lastSpokenSeq !== startSpokenSeq && happenedWithin(st.lastReplyAt, 15_000)) {
      return sseResponse(SILENCE, model);
    }
    const fresh = await getCall(callId);
    if (!fresh || ENDED_STATUSES.includes(fresh.status)) {
      return sseResponse(CALL_ENDED_LINE, model);
    }
    await sleep(200);
  }

  /* ---- no reply yet → let Fish's own agent brain talk naturally ---- */
  const fresh = await getCall(callId);
  return delegateToPlatformBrain(fresh, model);
}
