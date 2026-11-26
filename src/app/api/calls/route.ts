import { NextRequest } from "next/server";
import { resolveAgentAuth, unauthorized } from "@/lib/auth";
import { dispatchTool } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/calls — REST mirror of the notify_task_complete MCP tool.
 * Body: { summary, title?, priority?, task_ref? }
 */
export async function POST(req: NextRequest) {
  const ctx = await resolveAgentAuth(req);
  if (!ctx) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const result = await dispatchTool("notify_task_complete", body, ctx);
  const isError = "isError" in result && result.isError;
  const text = result.content[0].text;
  try {
    return Response.json(JSON.parse(text as string), { status: isError ? 400 : 201 });
  } catch {
    return Response.json({ message: text }, { status: isError ? 400 : 201 });
  }
}

export async function GET(req: NextRequest) {
  const ctx = await resolveAgentAuth(req);
  if (!ctx) return unauthorized();
  const result = await dispatchTool("get_call_status", {}, ctx);
  try {
    return Response.json(JSON.parse(result.content[0].text as string));
  } catch {
    return Response.json({ message: result.content[0].text });
  }
}
