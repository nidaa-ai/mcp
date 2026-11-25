import { NextRequest } from "next/server";
import { checkDeviceToken, isValidDevice } from "@/lib/auth";
import { getAgentApiKey, getVapidKeys } from "@/lib/settings";
import { getAgentInfo } from "@/lib/fish";
import { listCalls, publicCall, markRingingTimeouts } from "@/lib/calls";
import { FISH_AGENT_ID, APP_ACCESS_CODE } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/app-config?token=DEVICE_TOKEN — everything the web app needs:
 * the MCP/REST connection configs (ready to copy), VAPID key, Fish agent info.
 */
export async function GET(req: NextRequest) {
  const token = checkDeviceToken(req);
  if (!token || !(await isValidDevice(token))) return Response.json({ error: "unauthorized device token" }, { status: 401 });

  const origin = new URL(req.url).origin;
  const key = await getAgentApiKey();
  const vapid = await getVapidKeys().catch(() => ({ publicKey: null as string | null, privateKey: null as string | null }));
  const agent = await getAgentInfo().catch(() => null);
  await markRingingTimeouts().catch(() => {});
  const calls = await listCalls(12).catch(() => []);

  const mcpUrl = `${origin}/api/mcp?key=${key}`;
  const restBase = `${origin}/api`;

  return Response.json({
    origin,
    agent_api_key: key,
    access_code_default: APP_ACCESS_CODE === "0000",
    vapid_public_key: vapid.publicKey ?? null,
    fish_agent: agent ? { ...agent, configured: !!FISH_AGENT_ID } : { configured: !!FISH_AGENT_ID },
    recent_calls: calls.map(publicCall),
    configs: {
      chatgpt: {
        label: "ChatGPT (Apps / Connectors)",
        url: mcpUrl,
        note: "ChatGPT → Settings → Apps & Connectors → Create → نوع MCP → الصق الرابط. افتح Developer mode لو ظهر.",
      },
      claude: {
        label: "Claude Desktop",
        json: {
          mcpServers: {
            nidaa: {
              type: "http",
              url: `${origin}/api/mcp`,
              headers: { Authorization: `Bearer ${key}` },
            },
          },
        },
      },
      cursor: {
        label: "Cursor",
        json: {
          mcpServers: {
            nidaa: {
              url: `${origin}/api/mcp`,
              headers: { Authorization: `Bearer ${key}` },
            },
          },
        },
      },
      rest: {
        label: "REST (any tool)",
        notify: `curl -X POST ${restBase}/calls -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '{"summary":"..."}'`,
        poll: `curl "${restBase}/calls/CALL_ID/updates?since=0&wait=25" -H "Authorization: Bearer ${key}"`,
        send: `curl -X POST ${restBase}/calls/CALL_ID/updates -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '{"message":"..."}'`,
      },
      mcp_json: {
        label: "Generic MCP (JSON)",
        json: { url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${key}` } },
      },
    },
  });
}
