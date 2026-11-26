import { NextRequest } from "next/server";
import { checkDeviceToken, isValidDevice } from "@/lib/auth";
import { maskSecret } from "@/lib/settings";
import { getAgentInfo } from "@/lib/fish";
import { deviceEmail, saveUserFishConfig, getUserFishConfig } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HEX_ID = /^[a-f0-9]{16,64}$/i;

/**
 * POST /api/admin/fish-settings — save THIS account's Fish Audio credentials
 * (multi-tenant: stored per user in the users table, never shared). Body
 * (all optional, partial update):
 *   { fish_api_key?, fish_agent_id?, fish_phone_number_id? }
 * After saving, verifies the key+agent against the Fish API and returns the
 * agent info so the UI can confirm immediately.
 */
export async function POST(req: NextRequest) {
  const token = checkDeviceToken(req);
  if (!token || !(await isValidDevice(token))) return Response.json({ error: "unauthorized device token" }, { status: 401 });

  const email = await deviceEmail(token);
  if (!email) {
    return Response.json({ error: "الجهاز ده مش مرتبط بحساب — سجّل دخول تاني بالإيميل" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const apiKey = typeof body.fish_api_key === "string" ? body.fish_api_key.trim() : "";
  const agentId = typeof body.fish_agent_id === "string" ? body.fish_agent_id.trim() : "";
  const phoneId = typeof body.fish_phone_number_id === "string" ? body.fish_phone_number_id.trim() : "";

  if (apiKey && apiKey.length < 16) {
    return Response.json({ error: "الـ API Key قصير أو غلط — اتأكد إنك نسخت كله" }, { status: 400 });
  }
  if (agentId && !HEX_ID.test(agentId)) {
    return Response.json({ error: "الـ Agent ID لازم يكون hex (زي d0df6840a7454f92aa818ff8575eeff4)" }, { status: 400 });
  }
  if (phoneId && !HEX_ID.test(phoneId)) {
    return Response.json({ error: "الـ Phone Number ID لازم يكون hex" }, { status: 400 });
  }
  if (!apiKey && !agentId && !phoneId) {
    return Response.json({ error: "مفيش حاجة تتخزن — اكتب قيمة واحدة على الأقل" }, { status: 400 });
  }

  await saveUserFishConfig(email, { fish_api_key: apiKey, fish_agent_id: agentId, fish_phone_number_id: phoneId });

  const cfg = await getUserFishConfig(email);
  // live verification against Fish (only if key+agent are both set)
  const agent = cfg.api_key && cfg.agent_id ? await getAgentInfo(cfg).catch(() => null) : null;

  return Response.json({
    ok: true,
    email,
    fish_config: {
      api_key_set: !!cfg.api_key,
      api_key_masked: maskSecret(cfg.api_key),
      agent_id: cfg.agent_id,
      phone_number_id: cfg.phone_number_id,
    },
    agent, // null = could not verify (bad key/agent or Fish down)
  });
}
