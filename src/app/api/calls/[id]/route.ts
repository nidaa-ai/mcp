import { NextRequest } from "next/server";
import { resolveAgentAuth, checkDeviceToken, unauthorized, isValidDevice } from "@/lib/auth";
import { getCall, getEventsSince, getPendingAgentUpdates, markRingingTimeouts, publicCall, callVisibleTo } from "@/lib/calls";
import { deviceEmail } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calls/{id} — call status + full timeline.
 * Auth: agent key (REST, scoped to the owning user) OR device token (the web app).
 * A call is only visible to the account that owns it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveAgentAuth(req);
  const deviceToken = checkDeviceToken(req);
  const isDevice = !!deviceToken && (await isValidDevice(deviceToken));
  if (!ctx && !isDevice) return unauthorized();

  await markRingingTimeouts();
  const call = await getCall(id);
  if (!call) return Response.json({ error: "not found" }, { status: 404 });
  const viewer = ctx?.email ?? (deviceToken ? await deviceEmail(deviceToken) : null);
  if (!callVisibleTo(call, viewer)) return Response.json({ error: "not found" }, { status: 404 });
  const events = await getEventsSince(id, 0);
  const pending = await getPendingAgentUpdates(id, false);
  return Response.json({
    ...publicCall(call),
    events: events.map((e) => ({ seq: e.seq, kind: e.kind, text: e.text, ts: e.created_at, spoken: !!e.spoken })),
    pending_agent_updates: pending.length,
  });
}
