import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { checkAgentAuth, unauthorized } from "@/lib/auth";
import { getCall, addEvent, claimAgentUpdates, isAgentFollowing, setCallFields, sleep } from "@/lib/calls";
import { LLM_BRIDGE_WAIT_MS } from "@/lib/env";
import { relayState, noteReplySpoken, happenedWithin } from "@/lib/relay-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * OpenAI-compatible chat-completions endpoint that Fish Audio's Voice Agent
 * (custom LLM) calls on every conversation turn.
 *
 * A LIVE relay between the human on the call and the connected AI agent
 * (ChatGPT/Claude over MCP). This endpoint NEVER answers requests by itself:
 *  - every user utterance is logged so wait_for_call_updates returns it to
 *    the agent as a live command,
 *  - the turn waits a few seconds for the agent's send_call_update reply and
 *    speaks it the MOMENT it lands, framed as "رد الإيجنت: ..." so it is
 *    always clear WHO answered,
 *  - while the agent is still working it says one short human hold line, then
 *    tiny varied acknowledgments — never the same sentence twice,
 *  - the browser injects "__NDAA_AGENT_UPDATE__" turns to make late agent
 *    replies audible immediately. A duplicate injection (the reply was
 *    already spoken by the in-turn wait loop, which won the atomic claim)
 *    stays SILENT — no "no reply yet" dead line, ever,
 *  - if the agent is not connected to the call it says so once, briefly —
 *    the speech is already queued for the agent to pick up when it returns.
 */
export const AGENT_UPDATE_MARKER = "__NDAA_AGENT_UPDATE__";

/**
 * Attribution is fixed on purpose: the caller must always know WHO answered.
 * Everything else varies; this prefix is the one stable anchor.
 */
const AGENT_FRAME = "رد الإيجنت: ";
const CALL_ENDED_LINE = "المكالمة اتقفلت. مع السلامة.";
/** Whitespace-only turn: the voice channel stays silent. */
const SILENCE = " ";

/** First hold line while the agent works — short, Egyptian, rotated. */
const HOLD_LINES = [
  "ثواني، هو شغّال عليه.",
  "لحظة، بوصّله له.",
  "هو بيعملها دلوقتي، أول ما يخلص هقولك.",
  "استنى عليه ثواني بس.",
];
/** The user kept talking while the agent works — tiny live acknowledgments. */
const ACK_LINES = ["تمام.", "أيوة.", "ماشي.", "تمام، هو لسه شغّال."];
/** Agent not connected — full line once, then short reminders. */
const NO_AGENT_FIRST =
  "الإيجنت مش متوصل على الخط دلوقتي. كلامك اتسجلله وهاوصّله أول ما يرجع — لو دردشته مقفولة افتحها وقول له كمّل المتابعة.";
const NO_AGENT_AGAIN = [
  "لسه مش متوصل، أول ما يرجع هوصّله.",
  "هو بره الخط، كلامك محفوظ له.",
];

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
    // bound Twilio number): let the platform fallback LLM answer instead.
    return Response.json(
      { error: "no call_id mapping — reserved for the platform fallback model", hint: "configure llm.fallback for unmapped sessions" },
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
    // Nothing to claim: this injection raced with the in-turn wait loop and
    // the reply was ALREADY spoken in the previous turn. Stay silent — this
    // is exactly where the old "لسه مفيش رد جديد من الإيجنت" line made the
    // call feel dead while the reply was on screen a second earlier.
    return sseResponse(SILENCE, model);
  }

  // No user turn at all (e.g. a session warm-up call): the opener is already
  // speaking from overrides.first_message — nothing to relay yet.
  if (lastUserIdx === -1) {
    return sseResponse(SILENCE, model);
  }

  /* ---- case 2: a real user utterance (deduped) ---- */
  if (lastUserIdx >= 0 && lastUserText.trim()) {
    const hash = createHash("sha256").update(lastUserText).digest("hex").slice(0, 16);
    const isDuplicate = call.last_user_idx === lastUserIdx && call.last_user_hash === hash;
    if (!isDuplicate) {
      await addEvent(callId, "user_speech", lastUserText);
      await setCallFields(callId, { last_user_idx: lastUserIdx, last_user_hash: hash });
    }

    // Wait for the connected agent (ChatGPT/Claude) to send its reply. The
    // claim is atomic, so the browser's marker injection and this loop can
    // never both speak the same update.
    const st = relayState(callId);
    const startSpokenSeq = st.lastSpokenSeq;
    const deadline = Date.now() + LLM_BRIDGE_WAIT_MS;
    while (Date.now() < deadline) {
      const claimed = await claimAgentUpdates(callId);
      const text = joinClaimed(claimed);
      if (text) {
        noteReplySpoken(callId, claimed.map((e) => e.seq));
        return sseResponse(AGENT_FRAME + text, model);
      }
      // The marker turn won the race and just delivered the reply while we
      // were waiting — go quiet instead of stacking a line on top of it.
      if (st.lastSpokenSeq !== startSpokenSeq && happenedWithin(st.lastReplyAt, 15_000)) {
        return sseResponse(SILENCE, model);
      }
      const fresh = await getCall(callId);
      if (!fresh || ENDED_STATUSES.includes(fresh.status)) {
        return sseResponse(CALL_ENDED_LINE, model);
      }
      await sleep(250);
    }
  }

  const freshCall = await getCall(callId);
  if (freshCall && ENDED_STATUSES.includes(freshCall.status)) {
    return sseResponse(CALL_ENDED_LINE, model);
  }
  const st = relayState(callId);
  const following = freshCall ? isAgentFollowing(freshCall) : false;

  if (!following) {
    // Pure relay: never answer the request ourselves. The utterance is
    // already queued (user_speech event) and reaches the agent when it
    // re-enters the loop. Say it in full once, then keep it short.
    const line = happenedWithin(st.lastNoAgentAt, 90_000)
      ? NO_AGENT_AGAIN[st.holds % NO_AGENT_AGAIN.length]
      : NO_AGENT_FIRST;
    st.lastNoAgentAt = Date.now();
    st.holds += 1;
    return sseResponse(line, model);
  }

  // The MCP client is on the call and working; its reply hasn't arrived yet.
  // One natural hold line first, tiny acknowledgments afterwards.
  const line = happenedWithin(st.lastHoldAt, 45_000)
    ? ACK_LINES[st.holds % ACK_LINES.length]
    : HOLD_LINES[st.holds % HOLD_LINES.length];
  st.lastHoldAt = Date.now();
  st.holds += 1;
  return sseResponse(line, model);
}
