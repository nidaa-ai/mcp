import { NextRequest } from "next/server";
import { checkAgentAuth, checkDeviceToken, unauthorized, isValidDevice } from "@/lib/auth";
import { getCall, getEventsSince, getPendingAgentUpdates, markRingingTimeouts, publicCall } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calls/{id} — call status + full timeline.
 * Auth: agent key (REST) OR device token (the web app).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAgent = await checkAgentAuth(req);
  const deviceToken = checkDeviceToken(req);
  const isDevice = !!deviceToken && (await isValidDevice(deviceToken));
  if (!isAgent && !isDevice) return unauthorized();

  await markRingingTimeouts();
  const call = await getCall(id);
  if (!call) return Response.json({ error: "not found" }, { status: 404 });
  const events = await getEventsSince(id, 0);
  const pending = await getPendingAgentUpdates(id, false);
  return Response.json({
    ...publicCall(call),
    events: events.map((e) => ({ seq: e.seq, kind: e.kind, text: e.text, ts: e.created_at, spoken: !!e.spoken })),
    pending_agent_updates: pending.length,
  });
}
