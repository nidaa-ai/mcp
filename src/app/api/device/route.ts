import { NextRequest } from "next/server";
import { normalizeLoginEmail, emailAllowed, randomToken, isValidDevice } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { getVapidKeys } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/device — direct sign-in with an email (no password, no code).
 * First time = the account is created instantly; after that the browser
 * stays signed in via the long-lived device token (kept in localStorage).
 * Body: { email: string, label?: string }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const email = normalizeLoginEmail(body.email);
  if (!email) {
    return Response.json({ error: "اكتب إيميل صحيح (زي you@gmail.com)" }, { status: 400 });
  }
  if (!emailAllowed(email)) {
    return Response.json({ error: "الإيميل ده مش مسموح له بالدخول" }, { status: 403 });
  }
  await ensureSchema();
  const now = Date.now();
  // upsert the user (first login creates the account)
  await db.execute({
    sql: `INSERT INTO users (email, created_at, last_login) VALUES (?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET last_login = excluded.last_login`,
    args: [email, now, now],
  });
  const id = randomToken();
  await db.execute({
    sql: "INSERT INTO devices (id, label, user_email, created_at, last_seen) VALUES (?, ?, ?, ?, ?)",
    args: [id, String(body.label ?? "web").slice(0, 100), email, now, now],
  });
  return Response.json({ device_token: id, email, created_at: now }, { status: 201 });
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
