import { NextRequest } from "next/server";
import { checkDeviceToken, isValidDevice } from "@/lib/auth";
import { getAgentApiKey, getVapidKeys, getFishConfig, maskSecret } from "@/lib/settings";
import { getAgentInfo } from "@/lib/fish";
import { listCalls, publicCall, markRingingTimeouts } from "@/lib/calls";
import { deviceEmail, ensureUserApiKey, getUserFishConfig } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/app-config?token=DEVICE_TOKEN — everything the web app needs:
 * the MCP/REST connection configs (ready to copy, THIS account's key), VAPID
 * key, and THIS account's Fish agent info. Multi-tenant: each user gets
 * their own agent key and their own Fish credentials view.
 */
export async function GET(req: NextRequest) {
  const token = checkDeviceToken(req);
  if (!token || !(await isValidDevice(token))) return Response.json({ error: "unauthorized device token" }, { status: 401 });

  const origin = new URL(req.url).origin;
  const user = await deviceEmail(token);
  // This account's own MCP key (generated on first view). Falls back to the
  // legacy global key only for devices with no account attached.
  const key = user ? await ensureUserApiKey(user) : await getAgentApiKey();
  const vapid = await getVapidKeys().catch(() => ({ publicKey: null as string | null, privateKey: null as string | null }));
  const fishCfg = user ? await getUserFishConfig(user) : await getFishConfig();
  const agent = await getAgentInfo(fishCfg).catch(() => null);
  await markRingingTimeouts().catch(() => {});
  const calls = await listCalls(12, user).catch(() => []);

  const mcpUrl = `${origin}/api/mcp?key=${key}`;
  const restBase = `${origin}/api`;

  return Response.json({
    origin,
    agent_api_key: key,
    user_email: user,
    vapid_public_key: vapid.publicKey ?? null,
    fish_agent: agent ? { ...agent, configured: !!fishCfg.agent_id && !!fishCfg.api_key } : { configured: !!fishCfg.agent_id && !!fishCfg.api_key },
    fish_config: {
      api_key_set: !!fishCfg.api_key,
      api_key_masked: maskSecret(fishCfg.api_key),
      agent_id: fishCfg.agent_id,
      phone_number_id: fishCfg.phone_number_id,
    },
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
