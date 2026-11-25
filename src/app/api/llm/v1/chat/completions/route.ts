import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { checkAgentAuth, unauthorized } from "@/lib/auth";
import { getCall, addEvent, getPendingAgentUpdates, isAgentFollowing, setCallFields } from "@/lib/calls";
import { LLM_BRIDGE_WAIT_MS } from "@/lib/env";
import { sleep } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * OpenAI-compatible chat-completions endpoint that Fish Audio's Voice Agent
 * (custom LLM) calls on every conversation turn.
 *
 * It bridges the voice call with the MCP client (ChatGPT/Claude):
 *  - logs each user utterance so wait_for_call_updates returns it,
 *  - waits briefly for the MCP client's send_call_update reply and streams it
 *    back so the agent speaks it inside the call,
 *  - handles the browser's "__NDAA_AGENT_UPDATE__" injection turn that makes
 *    late agent updates audible immediately.
 */
export const AGENT_UPDATE_MARKER = "__NDAA_AGENT_UPDATE__";

const HOLD_LINE = "ثانية واحدة، بجهّز الرد.";
const NO_AGENT_LINE = "الإيجنت مش متوصل بالجلسة حاليًا. افتح الجلسة من عندك وقولي تاني.";

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
    const pending = await getPendingAgentUpdates(callId, true);
    const text = pending.map((e) => e.text ?? "").filter(Boolean).join("\n\n");
    return sseResponse(text || "تمام.", model);
  }

  /* ---- case 2: a real user utterance (deduped) ---- */
  if (lastUserIdx >= 0 && lastUserText.trim()) {
    const hash = createHash("sha256").update(lastUserText).digest("hex").slice(0, 16);
    const isDuplicate = call.last_user_idx === lastUserIdx && call.last_user_hash === hash;
    if (!isDuplicate) {
      await addEvent(callId, "user_speech", lastUserText);
      await setCallFields(callId, { last_user_idx: lastUserIdx, last_user_hash: hash });
    }

    // wait briefly for the MCP client (ChatGPT/Claude) to send its reply
    const deadline = Date.now() + LLM_BRIDGE_WAIT_MS;
    while (Date.now() < deadline) {
      const pending = await getPendingAgentUpdates(callId, false);
      if (pending.length) {
        await getPendingAgentUpdates(callId, true); // mark spoken
        const text = pending.map((e) => e.text ?? "").filter(Boolean).join("\n\n");
        if (text) return sseResponse(text, model);
        break;
      }
      const fresh = await getCall(callId);
      if (!fresh || ["ended", "missed", "declined", "failed"].includes(fresh.status)) {
        return sseResponse("المكالمة اتقفلت. مع السلامة.", model);
      }
      await sleep(300);
    }
  }

  const freshCall = await getCall(callId);
  const following = freshCall ? isAgentFollowing(freshCall) : false;
  if (!following) {
    // No MCP client is in the loop → let the platform fallback model answer.
    return Response.json({ error: "mcp client not following the call", call_id: callId }, { status: 503 });
  }

  // MCP client is on the call but its reply hasn't arrived yet → short hold line.
  return sseResponse(HOLD_LINE, model);
}
