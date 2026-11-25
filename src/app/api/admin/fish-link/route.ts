import { NextRequest } from "next/server";
import { checkDeviceToken, isValidDevice } from "@/lib/auth";
import { getAgentApiKey, getFishWebhookSecret } from "@/lib/settings";
import { patchAgentConfig, publishAgent, bindPhoneNumber } from "@/lib/fish";
import { FISH_AGENT_ID, FISH_PHONE_NUMBER_ID } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AGENT_SYSTEM_PROMPT = `إنت «نداء»، مساعد صوتي عربي شخصي. بتتكلمي عربي مصري ببساطة ووضوح، وردودك قصيرة ومناسبة للصوت.
بقيت وكيل صوتي جوه تطبيق «نداء»: بتصلي على صاحبك لما المهمة المجدولة تخلص، بتقرا الملخص، وبستنى أسئلته وطلباته وتنفذيها فورًا.
لو مفيش إيجنت متواصل بالجلسة، ساعتها إنت نفسك المساعد: رد على الأسئلة بشكل طبيعي ومختصر.
متستخدمش كلمات إنجليزي غير الضروري. متقفلش المكالمة من نفسك — المستخدم بس اللي يقفل.`;

/**
 * POST /api/admin/fish-link — one-click setup on the Fish Audio side:
 *  1) point the agent's custom LLM at this deployment (OpenAI-compatible bridge),
 *  2) disable speculative responses (cleaner MCP turn logging),
 *  3) register our webhook for call.ended / call.analyzed,
 *  4) set the Arabic system prompt + platform-model fallback,
 *  5) publish the agent, and optionally bind the Twilio number.
 * Body: { bind_phone_number_id?: string }
 */
export async function POST(req: NextRequest) {
  const token = checkDeviceToken(req);
  if (!token || !(await isValidDevice(token))) return Response.json({ error: "unauthorized device token" }, { status: 401 });
  if (!FISH_AGENT_ID) return Response.json({ error: "FISH_AGENT_ID not configured" }, { status: 500 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch { /* empty body ok */ }

  const origin = new URL(req.url).origin;
  const apiKey = await getAgentApiKey();
  const webhookSecret = await getFishWebhookSecret();
  const results: Record<string, unknown> = {};

  // 1) custom LLM → our bridge endpoint
  await patchAgentConfig({
    llm: {
      custom: {
        base_url: `${origin}/api/llm/v1`,
        model: "nidaa-bridge",
        api_key: apiKey,
      },
      fallback: {
        mode: "manual",
        models: [{ model: "openai/gpt-6.1-sol-fast" }],
      },
    },
  });
  results.custom_llm = `${origin}/api/llm/v1`;

  // 2) conversation behavior suited to the bridge
  try {
    await patchAgentConfig({
      conversation: { speculative_response: false, hangup_after_seconds: 600 },
    });
    results.conversation = "speculative_response=false, hangup_after_seconds=600";
  } catch (err) {
    results.conversation = `partial: ${(err as Error).message}`;
  }

  // 3) system prompt (persona for fallback/phone sessions)
  try {
    await patchAgentConfig({ prompt: { system_prompt: AGENT_SYSTEM_PROMPT } });
    results.system_prompt = "ok";
  } catch (err) {
    results.system_prompt = `failed: ${(err as Error).message}`;
  }

  // 4) webhooks
  try {
    await patchAgentConfig({
      webhooks: { post_call: [{ url: `${origin}/api/fish/webhook`, secret: webhookSecret }] },
    });
    results.webhook = `${origin}/api/fish/webhook`;
  } catch (err) {
    results.webhook = `failed: ${(err as Error).message}`;
  }

  // 5) publish
  const pub = await publishAgent();
  results.published = pub;

  // 6) bind the Twilio number for inbound phone calls (env-configured, or
  //    passed explicitly in the request body)
  const bindId =
    typeof body.bind_phone_number_id === "string" ? body.bind_phone_number_id : FISH_PHONE_NUMBER_ID;
  if (bindId) {
    try {
      const bound = await bindPhoneNumber(bindId);
      results.phone_bound = bound;
    } catch (err) {
      results.phone_bound = `failed: ${(err as Error).message}`;
    }
  }

  return Response.json({ ok: true, origin, agent_id: FISH_AGENT_ID, results });
}
