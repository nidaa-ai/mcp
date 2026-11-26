import { NextRequest } from "next/server";
import { checkDeviceToken, isValidDevice } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { listCalls, getEventsSince, markRingingTimeouts } from "@/lib/calls";
import { deviceEmail } from "@/lib/users";
import { bus } from "@/lib/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/events?token=DEVICE_TOKEN — Server-Sent Events channel for the
 * web app: incoming calls, live updates, status changes. MULTI-TENANT: only
 * the events of the calls owned by THIS device's account are streamed.
 * Polls the DB (serverless-safe) and wakes early on the in-process bus.
 */
export async function GET(req: NextRequest) {
  const token = checkDeviceToken(req);
  if (!token || !(await isValidDevice(token))) return Response.json({ error: "unauthorized device token" }, { status: 401 });
  await ensureSchema();
  const email = await deviceEmail(token);
  await db.execute({ sql: "UPDATE devices SET last_seen = ? WHERE id = ?", args: [Date.now(), token] });

  const url = new URL(req.url);
  const sinceParam = Number(url.searchParams.get("since") ?? 0) || 0;
  const startSeq = await getMaxSeq();
  // Fresh connect (no cursor): start from NOW — never replay history.
  // Reconnect WITH an explicit cursor: honor it EXACTLY. Updates that landed
  // while the browser was reconnecting must still be delivered — skipping
  // them here is what left agent replies visible on screen but never spoken.
  let cursor = sinceParam > 0 ? sinceParam : startSeq;

  const encoder = new TextEncoder();
  const state = { closed: false, wake: (() => {}) as () => void };

  const onBus = () => state.wake();
  bus.on("event", onBus);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { state.closed = true; }
      };

      const cleanup = () => {
        if (state.closed) return;
        state.closed = true;
        bus.off("event", onBus);
      };

      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch { /* noop */ }
      });

      send("hello", { ok: true, since: cursor, ts: Date.now() });

      const tick = async () => {
        try {
          await markRingingTimeouts();
          const events = await getNewEvents(cursor, email);
          for (const e of events) {
            cursor = Math.max(cursor, e.seq);
            if (e.kind === "agent_update") {
              send("call:update", { call_id: e.call_id, seq: e.seq, kind: e.kind, text: e.text, ts: e.created_at });
            } else if (e.kind === "summary") {
              send("call:incoming", { call_id: e.call_id, seq: e.seq, text: e.text, ts: e.created_at });
            } else {
              send("call:event", { call_id: e.call_id, seq: e.seq, kind: e.kind, text: e.text, ts: e.created_at });
            }
          }
          // report silent status changes (missed / ended)
          const calls = await listCalls(10, email);
          for (const c of calls) {
            if (["missed", "declined", "ended", "failed"].includes(c.status) && (c.ended_at ?? 0) > 0) {
              const evs = await getEventsSince(c.id, 0, ["system"]);
              const lastEv = evs[evs.length - 1];
              if (lastEv && lastEv.seq > cursor) {
                cursor = lastEv.seq;
                send("call:status", { call_id: c.id, status: c.status, ended_by: c.ended_by, text: lastEv.text, ts: lastEv.created_at });
              }
            }
          }
        } catch { /* retry next tick */ }
      };

      const startedAt = Date.now();
      await tick();
      while (!state.closed && Date.now() - startedAt < 55_000) {
        await new Promise<void>((resolve) => {
          state.wake = resolve;
          setTimeout(resolve, 1200);
        });
        if (state.closed) break;
        await tick();
      }
      if (!state.closed) {
        send("bye", { reconnect: true });
        cleanup();
        try { controller.close(); } catch { /* noop */ }
      }
    },
    cancel() {
      state.closed = true;
      bus.off("event", onBus);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function getMaxSeq(): Promise<number> {
  const rs = await db.execute("SELECT COALESCE(MAX(seq), 0) AS s FROM call_events");
  const row = rs.rows[0] as unknown as { s: number | bigint } | undefined;
  return Number(row?.s ?? 0);
}

async function getNewEvents(cursor: number, email: string | null) {
  const rs = await db.execute({
    sql: `
      SELECT e.seq, e.call_id, e.kind, e.text, e.created_at
      FROM call_events e
      JOIN calls c ON c.id = e.call_id
      WHERE e.seq > ? AND (c.user_email = ? OR ? IS NULL)
      ORDER BY e.seq ASC LIMIT 100
    `,
    args: [cursor, email, email],
  });
  return rs.rows.map((r) => ({
    seq: r.seq as number,
    call_id: r.call_id as string,
    kind: r.kind as string,
    text: (r.text as string | null) ?? null,
    created_at: r.created_at as number,
  }));
}
