import { NextRequest } from "next/server";
import { checkDeviceToken, unauthorized, isValidDevice } from "@/lib/auth";
import { getCall, endCallInternal, callVisibleTo } from "@/lib/calls";
import { endVoiceSession } from "@/lib/fish";
import { deviceEmail, fishConfigForCall } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/calls/{id}/end — hang up. Device-only: only the user can close the call.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = checkDeviceToken(req);
  if (!token || !(await isValidDevice(token))) return unauthorized();
  const { id } = await params;

  const call = await getCall(id);
  if (!call) return Response.json({ error: "not found" }, { status: 404 });
  const email = await deviceEmail(token);
  if (!callVisibleTo(call, email)) return Response.json({ error: "not found" }, { status: 404 });
  if (["ended", "missed", "declined", "failed"].includes(call.status)) {
    return Response.json({ ok: true, status: call.status, note: "already ended" });
  }

  if (call.fish_session_id) await endVoiceSession(call.fish_session_id, await fishConfigForCall(call));
  await endCallInternal(id, call.answered_at ? "ended" : "declined", "user");
  return Response.json({ ok: true, status: call.answered_at ? "ended" : "declined", ended_by: "user" });
}
