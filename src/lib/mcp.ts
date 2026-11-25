import {
  createCall,
  getCall,
  listCalls,
  waitForUpdates,
  addEvent,
  getPendingAgentUpdates,
  publicCall,
} from "./calls";
import { sendPushToAll } from "./push";
import { WAIT_DEFAULT_SECONDS, WAIT_MAX_SECONDS } from "./env";

export const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INFO = { name: "nidaa-mcp", version: "1.0.0" };

export const INSTRUCTIONS = `Nidaa (نداء) — a live voice-call bridge between you (the AI agent) and the human user.

Workflow:
1) When a scheduled/background task finishes, call notify_task_complete with the summary. The user's phone starts ringing immediately (web app with a real call screen, ringtone, and voice).
2) Then loop: call wait_for_call_updates(call_id) repeatedly. Each call returns new user speech (transcribed live from the call) and call status. Keep looping until ended=true.
3) If the user asks you to do something during the call ("reply to my manager's email"), execute it right away, then deliver the result with send_call_update — it is spoken out loud inside the call instantly and shown as a purple "live update" bubble on the call screen.
4) Only the human can end the call (hanging up). You cannot end it. When wait_for_call_updates reports ended=true, finish with a final message and stop the loop.

Respond to the user in Egyptian/Standard Arabic (the call is in Arabic). Keep spoken replies short and natural.`;

interface ToolDef {
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: Record<string, ToolDef> = {
  notify_task_complete: {
    description:
      "ابلغ المستخدم بمكالمة صوتية حية أن مهمته انتهت (Report task completion with a live voice call). " +
      "Call this the moment a scheduled task or background job finishes. The user's phone rings with a real voice call; " +
      "the agent then joins the call and reads the summary aloud. Returns the call_id to follow with wait_for_call_updates.",
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
      "استمع لكل كلام المستخدم أثناء المكالمة (Long-poll for new speech and events in a live call). " +
      "Call it in a loop with the same call_id. Each call blocks up to wait_seconds, then returns new user utterances " +
      "(transcribed from the live call), agent updates already delivered, and the call status. Stop the loop when ended=true.",
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
      "Keep it short and spoken-style.",
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
    description: "شوف حالة مكالمة صوتية (Get a call's status). Without call_id, returns the recent calls list.",
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
  "الخطوة الجاية: نادِ wait_for_call_updates بنفس call_id في حلقة — كل ندهة بترجّع كلام المستخدم الجديد أثناء المكالمة. لو طلب منك حاجة، نفذها فورًا وبعّت النتيجة بـ send_call_update (هتتقال بصوت عالي جوه المكالمة). كرر لحد ما يرجع ended=true (المستخدم بس اللي يقفل).";

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
        ok: true,
        call_id: call.id,
        status: "ringing",
        ring_timeout_seconds: 60,
        next_step: LOOP_HINT_AR,
        next_step_en:
          "Now loop on wait_for_call_updates with this call_id to hear the user's speech; deliver actions' results via send_call_update; exit when ended=true.",
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
      return textResult({
        call_id: callId,
        status: call.status,
        ended,
        ended_by: call.ended_by ?? null,
        updates: events.map((e) => ({ seq: e.seq, kind: e.kind, text: e.text, ts: e.created_at })),
        next_since: events.length ? Math.max(...events.map((e) => e.seq)) : since,
        hint: ended
          ? call.status === "missed"
            ? "المستخدم ما ردش على المكالمة (missed). ممكن تبعت تحديث نصي أو تحاول تاني لاحقًا — انتهت الجلسة."
            : "المستخدم قفل المكالمة. انتهت الجلسة — اكتب ردك النهائي واقفل الحلقة."
          : undefined,
      });
    }
    case "send_call_update": {
      const callId = String(args.call_id ?? "").trim();
      const message = String(args.message ?? "").trim();
      if (!callId || !message) return errText("call_id و message مطلوبين (call_id and message are required)");
      const call = await getCall(callId);
      if (!call) return errText(`مفيش مكالمة بالمعرّف ده: ${callId} (unknown call_id)`);
      if (["ended", "missed", "declined", "failed"].includes(call.status)) {
        return textResult({ ok: false, status: call.status, note: "المكالمة مقفولة — التحديث اتخزن بس مش هيُقال." });
      }
      const kind = ["announcement", "result", "question"].includes(String(args.kind)) ? String(args.kind) : "announcement";
      const ev = await addEvent(callId, "agent_update", message, { kind });
      const { broadcastEvent } = await import("./bus");
      broadcastEvent({ type: "call:update", call_id: callId, seq: ev.seq });
      return textResult({
        ok: true,
        seq: ev.seq,
        status: call.status,
        note: "التحديث هيتقال بصوت عالي جوه المكالمة في نفس اللحظة ويظهر كفقاعة بنفسجية على شاشة المكالمة.",
      });
    }
    case "get_call_status": {
      const callId = args.call_id ? String(args.call_id).trim() : "";
      if (callId) {
        const call = await getCall(callId);
        if (!call) return errText(`مفيش مكالمة بالمعرّف ده: ${callId} (unknown call_id)`);
        const pending = await getPendingAgentUpdates(callId, false);
        return textResult({ ...publicCall(call), pending_agent_updates: pending.length });
      }
      const calls = await listCalls(10);
      return textResult({ calls: calls.map(publicCall) });
    }
    default:
      return errText(`أداة غير معروفة: ${name} (unknown tool)`);
  }
}
