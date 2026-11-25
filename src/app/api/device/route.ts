import { NextRequest } from "next/server";
import { accessCodeMatches, randomToken, isValidDevice } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { getVapidKeys } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/device — pair the web app with the access code.
 * Body: { code: string, label?: string }
 * Returns a long-lived device token (kept in localStorage).
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!accessCodeMatches(body.code)) {
    return Response.json({ error: "كود الدخول غلط (wrong access code)" }, { status: 401 });
  }
  await ensureSchema();
  const id = randomToken();
  const now = Date.now();
  await db.execute({
    sql: "INSERT INTO devices (id, label, created_at, last_seen) VALUES (?, ?, ?, ?)",
    args: [id, String(body.label ?? "web").slice(0, 100), now, now],
  });
  return Response.json({ device_token: id, created_at: now }, { status: 201 });
}

/**
 * PUT /api/device — save/update the web-push subscription for this device.
 * Body: { subscription: PushSubscriptionJSON }
 */
export async function PUT(req: NextRequest) {
  const token = req.headers.get("x-device-token");
  if (!token || !/^[a-f0-9]{48}$/.test(token) || !(await isValidDevice(token))) {
    return Response.json({ error: "unauthorized device token" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const sub = body.subscription;
  if (!sub || typeof sub !== "object") {
    return Response.json({ error: "subscription required" }, { status: 400 });
  }
  await ensureSchema();
  await db.execute({
    sql: "UPDATE devices SET push_json = ?, last_seen = ? WHERE id = ?",
    args: [JSON.stringify(sub), Date.now(), token],
  });
  return Response.json({ ok: true });
}

/**
 * GET /api/device — public-key info for push registration.
 */
export async function GET() {
  try {
    const keys = await getVapidKeys();
    return Response.json({ vapid_public_key: keys.publicKey });
  } catch {
    return Response.json({ vapid_public_key: null });
  }
}
