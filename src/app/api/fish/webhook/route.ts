import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getFishWebhookSecret } from "@/lib/settings";
import { getCall, endCallInternal, addEvent, setCallFields, createCall } from "@/lib/calls";
import { db, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/fish/webhook — Fish Audio webhook receiver.
 * Handles call.ended / call.analyzed / phone_call.dial_finished, verifies the
 * HMAC signature, and mirrors the result into the Nidaa call record.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-fish-webhook-signature") ?? "";
  const secret = await getFishWebhookSecret();
  if (secret) {
    const ok = verifySignature(raw, signature, secret);
    if (!ok) return new Response(null, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  const event = String(body.event ?? "");
  const session = (body.session ?? {}) as Record<string, unknown>;
  const sessionId = String(session.session_id ?? session.id ?? "");

  try {
    const call = sessionId ? await findByFishSession(sessionId) : null;

    if (call) {
      if (event === "call.ended" || event === "call.analyzed") {
        const reason = String((body as Record<string, unknown>).ended_reason ?? session.end_reason ?? "unknown");
        if (!["ended", "missed", "declined", "failed"].includes(call.status)) {
          await endCallInternal(call.id, "ended", `fish:${reason}`);
        }
      }
      if (event === "call.analyzed") {
        const items = (body.items ?? []) as unknown[];
        const analysis = (body.analysis ?? {}) as Record<string, unknown>;
        await setCallFields(call.id, { transcript_json: JSON.stringify({ items, analysis }) });
        if (analysis.summary) {
          await addEvent(call.id, "system", `تحليل المكالمة: ${String(analysis.summary).slice(0, 2000)}`, { analysis: true });
        }
      }
    } else if (sessionId && event === "call.ended") {
      // A phone call to the bound Twilio number (no Nidaa call mapping).
      const source = String(session.source ?? "phone");
      if (source === "phone" || source === "whatsapp") {
        const call = await createCall({
          title: `مكالمة ${source === "phone" ? "هاتفية" : "واتساب"} — ${sessionId.slice(0, 8)}`,
          summary: "مكالمة وردت على الرقم المرتبط بالإيجنت.",
          source,
        });
        await setCallFields(call.id, {
          status: "ended",
          fish_session_id: sessionId,
          ended_at: Date.now(),
          ended_by: `fish:${String(session.end_reason ?? "unknown")}`,
        });
      }
    }
  } catch {
    // acknowledge anyway so Fish does not retry forever
  }
  return new Response(null, { status: 204 });
}

async function findByFishSession(sessionId: string) {
  await ensureSchema();
  const rs = await db.execute({
    sql: "SELECT id FROM calls WHERE fish_session_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [sessionId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return getCall(row.id as string);
}

function verifySignature(rawBody: string, header: string, secret: string): boolean {
  const elements = new Map(
    header.split(",").map((el) => {
      const i = el.indexOf("=");
      return i === -1 ? [el, ""] : [el.slice(0, i), el.slice(i + 1)];
    }),
  );
  const t = elements.get("t") ?? "";
  const v1 = elements.get("v1") ?? "";
  if (!/^\d+$/.test(t) || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
