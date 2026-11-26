import { NextRequest } from "next/server";
import { checkDeviceToken, unauthorized, isValidDevice } from "@/lib/auth";
import { getCall, setCallFields, addEvent, markRingingTimeouts, publicCall, callVisibleTo } from "@/lib/calls";
import { createVoiceSession, buildFirstMessage } from "@/lib/fish";
import { deviceEmail, fishConfigForCall } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/calls/{id}/answer — the user accepted the call.
 * Creates the Fish Audio voice session with the CALL OWNER's credentials and
 * returns the session token JSON (fed verbatim to AgentSession.start in the
 * browser).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = checkDeviceToken(req);
  if (!token || !(await isValidDevice(token))) return unauthorized();
  const { id } = await params;

  await markRingingTimeouts();
  const call = await getCall(id);
  if (!call) return Response.json({ error: "not found" }, { status: 404 });
  const email = await deviceEmail(token);
  if (!callVisibleTo(call, email)) return Response.json({ error: "not found" }, { status: 404 });
  if (["ended", "missed", "declined", "failed"].includes(call.status)) {
    return Response.json({ error: `call already ${call.status}` }, { status: 409 });
  }

  // Multi-tenant: the voice session opens with THIS account's Fish credentials.
  const cfg = await fishConfigForCall(call);
  if (!cfg.api_key || !cfg.agent_id) {
    return Response.json(
      {
        error:
          "لازم تحط مفتاح Fish Audio وAgent ID بتوعك الأول — من بطاقة «إعدادات Fish Audio» في التطبيق",
        code: "fish_not_configured",
      },
      { status: 502 },
    );
  }

  try {
    const session = await createVoiceSession(call.id, call.title, call.summary, cfg);
    await setCallFields(id, {
      status: "active",
      answered_at: Date.now(),
      fish_session_id: session.session_id,
      first_message: buildFirstMessage(call.title, call.summary),
      fish_session_json: JSON.stringify(session),
    });
    await addEvent(id, "system", "تم الرد على المكالمة وبدأت الجلسة الصوتية", { session_id: session.session_id });
    const { broadcastEvent } = await import("@/lib/bus");
    broadcastEvent({ type: "call:status", call_id: id, status: "active" });

    // Return Fish's response verbatim (the SDK expects it unchanged),
    // plus the call info under a separate header-safe envelope field.
    const fresh = await getCall(id);
    return Response.json({ ...session, nidaa_call: fresh ? publicCall(fresh) : publicCall(call) }, { status: 200 });
  } catch (err) {
    return Response.json({ error: `voice session failed: ${(err as Error).message}` }, { status: 502 });
  }
}
