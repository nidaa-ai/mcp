import { db, ensureSchema } from "./db";
import { getVapidKeys } from "./settings";

export interface PushPayload {
  call_id: string;
  title: string;
  body: string;
  tag?: string;
}

interface PushDevice {
  id: string;
  push_json: string;
}

async function listPushDevices(userEmail?: string | null): Promise<PushDevice[]> {
  await ensureSchema();
  const scoped = typeof userEmail === "string" && userEmail.length > 0;
  const rs = await db.execute(
    scoped
      ? "SELECT id, push_json FROM devices WHERE push_json IS NOT NULL AND user_email = ?"
      : "SELECT id, push_json FROM devices WHERE push_json IS NOT NULL",
    scoped ? [userEmail] : [],
  );
  return rs.rows.map((r) => ({ id: r.id as string, push_json: r.push_json as string }));
}

async function deliver(devices: PushDevice[], payload: PushPayload): Promise<void> {
  if (!devices.length) return;
  const { publicKey, privateKey } = await getVapidKeys();
  const webpush = await import("web-push");
  webpush.default.setVapidDetails("mailto:support@nidaa.ai", publicKey, privateKey);
  await Promise.all(
    devices.map(async (d) => {
      try {
        await webpush.default.sendNotification(
          JSON.parse(d.push_json),
          JSON.stringify(payload),
          { TTL: 120, urgency: "high" },
        );
      } catch (err) {
        // Drop dead subscriptions silently.
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db.execute({ sql: "UPDATE devices SET push_json = NULL WHERE id = ?", args: [d.id] });
        }
      }
    }),
  );
}

/** Send a web push to one account's subscribed devices. Never throws. */
export async function sendPushToUser(userEmail: string | null, payload: PushPayload): Promise<void> {
  try {
    await deliver(await listPushDevices(userEmail), payload);
  } catch {
    // push is best-effort
  }
}

/** Send a web push to every subscribed device (legacy/ownerless). Never throws. */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  try {
    await deliver(await listPushDevices(), payload);
  } catch {
    // push is best-effort
  }
}
