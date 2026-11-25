import {
  createCall,
  getCall,
  listCalls,
  waitForUpdates,
  addEvent,
  getPendingAgentUpdates,
  publicCall,
  isAgentFollowing,
} from "./calls";
import { sendPushToAll } from "./push";
import { WAIT_DEFAULT_SECONDS, WAIT_MAX_SECONDS } from "./env";

export const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INFO = { name: "nidaa-mcp", version: "1.1.0" };

/**
 * The one rule that keeps the bridge alive. Repeated in the initialize
 * instructions, in every tool description, and in every tool result —
 * ChatGPT ends its turn unless the tool results themselves forbid it.
 */
const LOOP_RULE =
  "LOOP RULE: while ended=false keep calling wait_for_call_updates — never end your turn, never say goodbye, never write a summary. The ONLY exit is ended=true (the user hung up).";

export const INSTRUCTIONS = `Nidaa (نداء) — a LIVE voice-call bridge between you (the AI agent) and the human user.

THE CALL RULES (critical — the bridge dies if you break them):
• You are live on an open phone call with the user. ONLY the human can end it, by hanging up.
• While a call is open (wait_for_call_updates returns ended=false) you MUST NOT end your turn — no goodbye, no "I'll keep monitoring", no final summary, no plain chat reply. Ending your turn abandons the user mid-call.
• wait_for_call_updates is a heartbeat loop. An empty result (updates=[], ended=false) is normal silence on the line — call it AGAIN immediately with the same call_id and the returned next_since. Keep looping for the whole call, however long it lasts.
• Exit ONLY when ended=true. Then write a short final message and stop.

YOU ARE IN A LIVE WORKING SESSION TOGETHER:
While the call is open, the user's speech is a live command stream — you are their personal assistant ON the phone. Whatever they ask, do it in THIS SAME session, immediately, with your own tools (search, browsing, email, files, code, calendar — everything you can do):
 • "دوّر على أرخص تذكرة طيران القاهرة دبي" → search now, then speak the answer via send_call_update.
 • "ابعت لمراتي رسالة إني هاتأخر النهاردة" → send it now, then confirm by voice.
 • "خلّص التقرير ده وابعتهولي" → produce it now, then tell them it's done.
Never say "سأفعلها لاحقًا" (I'll do it later) — you are live together on the call: act now, answer by voice, then keep listening. Only small talk needs no tools — just answer briefly via send_call_update.

Workflow:
1) When a scheduled/background task finishes → notify_task_complete(summary). The user's phone rings immediately.
2) Immediately enter the heartbeat loop: wait_for_call_updates(call_id) → repeat → until ended=true.
3) When the user speaks (updates with kind=user_speech) treat it as a live command on the call: execute it right away with your tools, then deliver the result with send_call_update — it is spoken aloud inside the call instantly and appears as a purple "live update" bubble on the user's call screen — then resume the loop.
4) While the call is still ringing keep polling until the user answers (status="active") or the call is missed.

The call is in Egyptian/Standard Arabic. Keep spoken replies short and natural.`;

interface ToolDef {
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: Record<string, ToolDef> = {
  notify_task_complete: {
    description:
      "ابلغ المستخدم بمكالمة صوتية حية أن مهمته انتهت (Report task completion with a live voice call). " +
      "Call this the moment a scheduled task or background job finishes. The user's phone rings with a real voice call; " +
      "the agent then joins the call and reads the summary aloud. Returns the call_id. " +
      "IMPORTANT: right after this you MUST enter the wait_for_call_updates heartbeat loop and stay in it until ended=true — never end your turn while the call is open.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "ملخص النتيجة اللي هيتقال بصوت للمستخدم — اجعله قصيرًا وواضحًا (spoken aloud)" },
        title: { type: "string", description: "عنوان قصير للمهمة (اختياري)" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"], description: "أولوية التنبيه (اختياري)" },
        task_ref: { type: "string", description: "مرجع خارجي للمهمة (اختياري)" },
      },
      required: ["summary"],
    },
  },
  wait_for_call_updates: {
    description:
      "استمع لكل كلام المستخدم أثناء المكالمة — ندهة واحدة من حلقة الاستماع المستمرة (One heartbeat of the live listening loop). " +
      "Call it in a loop with the same call_id. Each call blocks up to wait_seconds server-side, then returns new user utterances " +
      "(transcribed live from the call), your own delivered updates (echo), and the call status. " +
      "The user's utterances are live commands: execute them in the SAME session with your own tools and answer by voice via send_call_update. " +
      "CRITICAL: an empty result with ended=false is normal silence — call this tool AGAIN immediately (it is a keep-alive heartbeat, not a final answer). " +
      "Never end your turn while ended=false; stop the loop only when ended=true (the user hung up).",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string", description: "معرّف المكالمة من notify_task_complete" },
        since: { type: "number", description: "آخر seq استلمته — مرّر next_since من الرد السابق (اختياري، افتراضي 0)" },
        wait_seconds: { type: "number", description: `مدة الانتظار بالثواني (افتراضي ${WAIT_DEFAULT_SECONDS}، أقصى ${WAIT_MAX_SECONDS})` },
      },
      required: ["call_id"],
    },
  },
  send_call_update: {
    description:
      "ابعت رسالة تُقال بصوت عالي داخل المكالمة في نفس اللحظة وتظهر كفقاعة بنفسجية «تحديث مباشر من الإيجنت» " +
      "(Speak a live update inside the ongoing call). Use it to deliver results of actions you executed for the user during the call. " +
      "Keep it short and spoken-style. " +
      "IMPORTANT: after sending, the call is still open — immediately resume the wait_for_call_updates loop until ended=true.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string", description: "معرّف المكالمة" },
        message: { type: "string", description: "نص التحديث — هيُقال بصوت عالي فورًا داخل المكالمة" },
        kind: { type: "string", enum: ["announcement", "result", "question"], description: "نوع التحديث (افتراضي announcement)" },
      },
      required: ["call_id", "message"],
    },
  },
  get_call_status: {
    description:
      "شوف حالة مكالمة صوتية (Get a call's status). Without call_id, returns the recent calls list. " +
      "If a call is active but you are not in its listening loop, this will tell you to resume wait_for_call_updates immediately.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string", description: "معرّف المكالمة (اختياري)" },
      },
    },
  },
};

function textResult(payload: unknown) {
  return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}

function errText(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}

const LOOP_HINT_AR =
  "الخطوة الجاية: نادِ wait_for_call_updates بنفس call_id في حلقة — كل ندهة بترجّع كلام المستخدم الجديد أثناء المكالمة. لو رجعت فاضية والمكالمة لسه مفتوحة ده معناه صمت طبيعي — نادِها تاني فورًا. لو طلب منك حاجة، نفذها فورًا وبعّت النتيجة بـ send_call_update (هتتقال بصوت عالي جوه المكالمة). متقفلش الدردشة خالص غير لما يرجع ended=true (المستخدم بس اللي يقفل).";

export async function dispatchTool(name: string, args: Record<string, unknown>): Promise<ReturnType<typeof textResult> | ReturnType<typeof errText>> {
  switch (name) {
    case "notify_task_complete": {
      const summary = String(args.summary ?? "").trim();
      if (!summary) return errText("summary مطلوب (summary is required)");
      const call = await createCall({
        summary,
        title: args.title ? String(args.title) : undefined,
        priority: args.priority ? String(args.priority) : undefined,
        task_ref: args.task_ref ? String(args.task_ref) : undefined,
        source: "mcp",
      });
      await sendPushToAll({
        call_id: call.id,
        title: call.title || "مكالمة من الإيجنت",
        body: summary.slice(0, 120),
        tag: call.id,
      });
      return textResult({
        directive:
          `CALL_STARTED — the user's phone is ringing NOW (call ${call.id}). ` +
          `IMMEDIATELY call wait_for_call_updates with {call_id:"${call.id}", since:0} and enter the heartbeat loop. ` +
          `When the user answers, the voice agent reads your summary aloud, then the two of you talk live. ` +
          LOOP_RULE,
        ok: true,
        call_id: call.id,
        status: "ringing",
        keep_looping: true,
        ring_timeout_seconds: 60,
        next_step: LOOP_HINT_AR,
        next_step_en:
          "Now loop on wait_for_call_updates with this call_id to hear the user's speech; an empty result is a keep-alive heartbeat — keep looping; deliver actions' results via send_call_update; exit only when ended=true.",
      });
    }
    case "wait_for_call_updates": {
      const callId = String(args.call_id ?? "").trim();
      if (!callId) return errText("call_id مطلوب (call_id is required)");
      const since = Number.isFinite(Number(args.since)) ? Math.max(0, Number(args.since)) : 0;
      let waitSec = Number.isFinite(Number(args.wait_seconds)) ? Number(args.wait_seconds) : WAIT_DEFAULT_SECONDS;
      waitSec = Math.max(0, Math.min(WAIT_MAX_SECONDS, waitSec));
      const { call, events } = await waitForUpdates(callId, since, waitSec * 1000);
      if (!call) return errText(`مفيش مكالمة بالمعرّف ده: ${callId} (unknown call_id)`);
      const ended = ["ended", "missed", "declined", "failed"].includes(call.status);
      const nextSince = events.length ? Math.max(...events.map((e) => e.seq)) : since;
      const ageSec = Math.max(0, Math.round((Date.now() - call.created_at) / 1000));
      const base = {
        call_id: callId,
        status: call.status,
        ended,
        ended_by: call.ended_by ?? null,
        keep_looping: !ended,
        age_seconds: ageSec,
        user_speech: events.filter((e) => e.kind === "user_speech").map((e) => ({ seq: e.seq, text: e.text, ts: e.created_at })),
        your_updates_echo: events.filter((e) => e.kind === "agent_update").map((e) => ({ seq: e.seq, text: e.text, ts: e.created_at })),
        system_events: events.filter((e) => e.kind === "system" || e.kind === "summary").map((e) => ({ seq: e.seq, text: e.text, ts: e.created_at })),
        updates: events.map((e) => ({ seq: e.seq, kind: e.kind, text: e.text, ts: e.created_at })),
        next_since: nextSince,
      };

      if (ended) {
        return textResult({
          directive:
            `CALL_ENDED (${call.status}${call.ended_by ? `, ended_by: ${call.ended_by}` : ""}). The call is over — the line is dead. ` +
            `NOW, and only now, you may leave the loop: write a short final chat message about the call and stop. Do not call any call tool again for this call_id.`,
          ...base,
          hint:
            call.status === "missed"
              ? "المستخدم ما ردش على المكالمة (missed). ممكن تبعت تحديث نصي أو تحاول تاني لاحقًا — انتهت الجلسة."
              : "المستخدم قفل المكالمة. انتهت الجلسة — اكتب ردك النهائي واقفل الحلقة.",
        });
      }

      if (call.status === "ringing") {
        return textResult({
          directive:
            `RINGING — the user's phone is still ringing (${ageSec}s so far, timeout 60s). Nobody picked up yet. ` +
            `Do NOT end your turn. Call wait_for_call_updates again NOW with {call_id:"${callId}", since:${nextSince}} and keep polling ` +
            `until the user answers (status becomes "active") or the call is marked missed. ${LOOP_RULE}`,
          ...base,
        });
      }

      const userSpeech = base.user_speech as { seq: number; text: string | null }[];
      if (userSpeech.length) {
        const quoted = userSpeech.map((u) => `"${(u.text ?? "").replace(/\s+/g, " ").trim()}"`).join(" | ");
        return textResult({
          directive:
            `USER_SAID — the user is talking to you LIVE on the call: ${quoted}. ` +
            `You are in a live working session together: execute their request NOW, in this same conversation, with your own tools ` +
            `(search / browsing / email / files / code — whatever it takes). When done, deliver the result with ` +
            `send_call_update({call_id:"${callId}", message:"..."}) so it is spoken aloud inside the call, then resume ` +
            `wait_for_call_updates. If the utterance is just small talk or acknowledgment, reply briefly via send_call_update and keep listening. ` +
            `Never postpone a request to "later" — you are live on the phone together. Do NOT end your turn. ${LOOP_RULE}`,
          ...base,
        });
      }

      if ((base.your_updates_echo as unknown[]).length) {
        return textResult({
          directive:
            `DELIVERED — those are your own updates, already spoken inside the call (echo). The call is still OPEN and the user is on the line. ` +
            `Call wait_for_call_updates again NOW with {call_id:"${callId}", since:${nextSince}} and keep listening. ${LOOP_RULE}`,
          ...base,
        });
      }

      return textResult({
        directive:
          `HEARTBEAT — the call is OPEN but the user is silent right now (${ageSec}s on the call so far). ` +
          `This empty result is a normal keep-alive, NOT a signal to stop. Call wait_for_call_updates again NOW with ` +
          `{call_id:"${callId}", since:${nextSince}} and keep looping until the user speaks or hangs up. ${LOOP_RULE}`,
        ...base,
      });
    }
    case "send_call_update": {
      const callId = String(args.call_id ?? "").trim();
      const message = String(args.message ?? "").trim();
      if (!callId || !message) return errText("call_id و message مطلوبين (call_id and message are required)");
      const call = await getCall(callId);
      if (!call) return errText(`مفيش مكالمة بالمعرّف ده: ${callId} (unknown call_id)`);
      if (["ended", "missed", "declined", "failed"].includes(call.status)) {
        return textResult({
          directive: `CALL_ENDED (${call.status}) — your update was stored but will NOT be spoken; the call is closed. You may write your final chat message now.`,
          ok: false,
          status: call.status,
          keep_looping: false,
          note: "المكالمة مقفولة — التحديث اتخزن بس مش هيُقال.",
        });
      }
      const kind = ["announcement", "result", "question"].includes(String(args.kind)) ? String(args.kind) : "announcement";
      const ev = await addEvent(callId, "agent_update", message, { kind });
      const { broadcastEvent } = await import("./bus");
      broadcastEvent({ type: "call:update", call_id: callId, seq: ev.seq });
      return textResult({
        directive:
          `SPOKEN_LIVE — your update is being spoken out loud inside the call right now and shows as a purple bubble on the user's screen. ` +
          `The user is STILL ON THE LINE (status: ${call.status}). Do NOT end your turn: resume listening NOW by calling ` +
          `wait_for_call_updates with {call_id:"${callId}", since:${ev.seq}} and keep the loop until ended=true. ${LOOP_RULE}`,
        ok: true,
        seq: ev.seq,
        status: call.status,
        keep_looping: true,
        note: "التحديث هيتقال بصوت عالي جوه المكالمة في نفس اللحظة ويظهر كفقاعة بنفسجية على شاشة المكالمة.",
      });
    }
    case "get_call_status": {
      const callId = args.call_id ? String(args.call_id).trim() : "";
      if (callId) {
        const call = await getCall(callId);
        if (!call) return errText(`مفيش مكالمة بالمعرّف ده: ${callId} (unknown call_id)`);
        const pending = await getPendingAgentUpdates(callId, false);
        const ended = ["ended", "missed", "declined", "failed"].includes(call.status);
        const following = isAgentFollowing(call);
        return textResult({
          directive: ended
            ? `CALL_ENDED (${call.status}) — nothing to do for this call.`
            : following
              ? `IN_LOOP — you are in the listening loop for this live call. Keep calling wait_for_call_updates until ended=true. ${LOOP_RULE}`
              : `WARNING — this call is LIVE (status: ${call.status}) but you are NOT in its listening loop. The user is on the line waiting for you. ` +
                `Call wait_for_call_updates NOW with {call_id:"${callId}", since:0} and keep looping until ended=true. ${LOOP_RULE}`,
          ...publicCall(call),
          pending_agent_updates: pending.length,
        });
      }
      const calls = await listCalls(10);
      const live = calls.find((c) => !["ended", "missed", "declined", "failed"].includes(c.status));
      return textResult({
        directive: live
          ? `LIVE_CALL — call ${live.id} is ${live.status} right now. Call wait_for_call_updates NOW with {call_id:"${live.id}", since:0} and keep looping until ended=true. ${LOOP_RULE}`
          : "No live calls. Nothing to do.",
        calls: calls.map(publicCall),
      });
    }
    default:
      return errText(`أداة غير معروفة: ${name} (unknown tool)`);
  }
}
