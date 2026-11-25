import { db, ensureSchema } from "./db";
import { getVapidKeys } from "./settings";

export interface PushPayload {
  call_id: string;
  title: string;
  body: string;
  tag?: string;
}

export async function listPushDevices(): Promise<{ id: string; push_json: string }[]> {
  await ensureSchema();
  const rs = await db.execute("SELECT id, push_json FROM devices WHERE push_json IS NOT NULL");
  return rs.rows.map((r) => ({ id: r.id as string, push_json: r.push_json as string }));
}

/** Send a web push to every subscribed device. Never throws. */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  try {
    const devices = await listPushDevices();
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
  } catch {
    // push is best-effort
  }
}
