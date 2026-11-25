import { NextRequest } from "next/server";
import { checkAgentAuth, unauthorized } from "@/lib/auth";
import { DEFAULT_PROTOCOL_VERSION, PROTOCOL_VERSIONS, SERVER_INFO, INSTRUCTIONS, TOOLS, dispatchTool } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, X-Api-Key",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...CORS, "Cache-Control": "no-store" },
  });
}

/**
 * Stateless Streamable-HTTP MCP server.
 * POST /api/mcp (or /api/mcp?key=...) — JSON-RPC 2.0.
 */
export async function POST(req: NextRequest) {
  if (!(await checkAgentAuth(req))) return unauthorized();

  let msg: Record<string, unknown>;
  try {
    msg = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  if (Array.isArray(msg) || typeof msg !== "object" || msg === null) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }, 400);
  }

  const id = (msg.id ?? null) as string | number | null;
  const method = String(msg.method ?? "");
  const isNotification = msg.id === undefined || msg.id === null;

  // protocol version negotiation
  const requested = req.headers.get("mcp-protocol-version")
    ?? (typeof (msg.params as Record<string, unknown> | undefined)?.protocolVersion === "string"
      ? ((msg.params as Record<string, unknown>).protocolVersion as string)
      : null);
  const protocolVersion = PROTOCOL_VERSIONS.includes(requested ?? "") ? requested! : DEFAULT_PROTOCOL_VERSION;
  const baseHeaders = { ...CORS, "Cache-Control": "no-store", "MCP-Protocol-Version": protocolVersion };

  const reply = (result: unknown) => new Response(
    JSON.stringify({ jsonrpc: "2.0", id, result }),
    { status: 200, headers: { ...baseHeaders, "Content-Type": "application/json" } },
  );
  const replyErr = (code: number, message: string) => new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    { status: 200, headers: { ...baseHeaders, "Content-Type": "application/json" } },
  );

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply({});
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return new Response(null, { status: 202, headers: baseHeaders });
    case "tools/list": {
      const toolDefs = Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return reply({ tools: toolDefs });
    }
    case "tools/call": {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (!TOOLS[name]) return replyErr(-32602, `Unknown tool: ${name}`);
      try {
        const result = await dispatchTool(name, args);
        const isError = "isError" in result && result.isError;
        const payload: Record<string, unknown> = { content: result.content };
        if (isError) payload.isError = true;
        return reply(payload);
      } catch (err) {
        return replyErr(-32603, `Tool execution failed: ${(err as Error).message}`);
      }
    }
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: [] });
    default:
      if (isNotification) return new Response(null, { status: 202, headers: baseHeaders });
      return replyErr(-32601, `Method not found: ${method}`);
  }
}

// Stateless server: no server-initiated SSE channel.
export async function GET(req: NextRequest) {
  if (!(await checkAgentAuth(req))) return unauthorized();
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "SSE channel not supported; use POST (stateless server)." } }),
    { status: 405, headers: { ...CORS, "Content-Type": "application/json", Allow: "POST, OPTIONS" } },
  );
}
