import { NextRequest } from "next/server";
import { checkAgentAuth, checkDeviceToken, unauthorized } from "@/lib/auth";
import { getCall, getEventsSince, markRingingTimeouts, publicCall } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET  /api/calls/{id}/updates?since=N[&wait=25] — poll / long-poll updates.
 * POST /api/calls/{id}/updates — send an agent update (REST mirror of send_call_update).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAgentAuth(req))) return unauthorized();
  const { id } = await params;
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? 0) || 0;
  const wait = Math.min(55, Math.max(0, Number(url.searchParams.get("wait") ?? 0) || 0));

  await markRingingTimeouts();
  let call = await getCall(id);
  if (!call) return Response.json({ error: "not found" }, { status: 404 });
  let events = await getEventsSince(id, since);

  if (wait > 0) {
    const deadline = Date.now() + wait * 1000;
    while (!events.length && Date.now() < deadline) {
      const ended = ["ended", "missed", "declined", "failed"].includes(call!.status);
      if (ended) break;
      await new Promise((r) => setTimeout(r, 400));
      events = await getEventsSince(id, since);
      call = await getCall(id);
    }
  }

  const ended = ["ended", "missed", "declined", "failed"].includes(call!.status);
  return Response.json({
    ...publicCall(call!),
    ended,
    updates: events.map((e) => ({ seq: e.seq, kind: e.kind, text: e.text, ts: e.created_at })),
    next_since: events.length ? Math.max(...events.map((e) => e.seq)) : since,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAgentAuth(req))) return unauthorized();
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const { dispatchTool } = await import("@/lib/mcp");
  const result = await dispatchTool("send_call_update", {
    call_id: id,
    message: body.message ?? body.text ?? "",
    kind: body.kind ?? "announcement",
  });
  const isError = "isError" in result && result.isError;
  try {
    return Response.json(JSON.parse(result.content[0].text as string), { status: isError ? 400 : 200 });
  } catch {
    return Response.json({ message: result.content[0].text }, { status: isError ? 400 : 200 });
  }
}
