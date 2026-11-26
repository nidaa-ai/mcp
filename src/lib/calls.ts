import { randomUUID } from "crypto";
import type { InValue } from "@libsql/client";
import { db, ensureSchema } from "./db";
import { RING_TIMEOUT_MS, AGENT_HEARTBEAT_MS } from "./env";
import { broadcastEvent } from "./bus";
import { forgetRelayState } from "./relay-state";

export type CallStatus = "ringing" | "active" | "ended" | "missed" | "declined" | "failed";
export type EventKind = "user_speech" | "agent_update" | "system" | "summary";

export interface CallRow {
  id: string;
  user_email: string | null;
  title: string;
  summary: string;
  priority: string;
  task_ref: string | null;
  source: string;
  status: CallStatus;
  fish_session_id: string | null;
  first_message: string | null;
  created_at: number;
  answered_at: number | null;
  ended_at: number | null;
  ended_by: string | null;
  last_activity: number | null;
  last_agent_poll: number | null;
  last_user_idx: number;
  last_user_hash: string;
}

export interface CallEvent {
  seq: number;
  call_id: string;
  kind: EventKind;
  text: string | null;
  meta: string | null;
  spoken: number;
  created_at: number;
}

export function toCallRow(row: Record<string, unknown>): CallRow {
  return {
    id: row.id as string,
    user_email: (row.user_email as string | null) ?? null,
    title: row.title as string,
    summary: row.summary as string,
    priority: row.priority as string,
    task_ref: (row.task_ref as string | null) ?? null,
    source: row.source as string,
    status: row.status as CallStatus,
    fish_session_id: (row.fish_session_id as string | null) ?? null,
    first_message: (row.first_message as string | null) ?? null,
    created_at: row.created_at as number,
    answered_at: (row.answered_at as number | null) ?? null,
    ended_at: (row.ended_at as number | null) ?? null,
    ended_by: (row.ended_by as string | null) ?? null,
    last_activity: (row.last_activity as number | null) ?? null,
    last_agent_poll: (row.last_agent_poll as number | number | null) ?? null,
    last_user_idx: (row.last_user_idx as number) ?? -1,
    last_user_hash: (row.last_user_hash as string) ?? "",
  };
}

export function toEvent(row: Record<string, unknown>): CallEvent {
  return {
    seq: row.seq as number,
    call_id: row.call_id as string,
    kind: row.kind as EventKind,
    text: (row.text as string | null) ?? null,
    meta: (row.meta as string | null) ?? null,
    spoken: (row.spoken as number) ?? 0,
    created_at: row.created_at as number,
  };
}

export function publicCall(c: CallRow) {
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    priority: c.priority,
    status: c.status,
    created_at: c.created_at,
    answered_at: c.answered_at,
    ended_at: c.ended_at,
    ended_by: c.ended_by,
    fish_session_id: c.fish_session_id,
    agent_following: isAgentFollowing(c),
  };
}

export function isAgentFollowing(c: CallRow): boolean {
  return !!c.last_agent_poll && Date.now() - c.last_agent_poll < AGENT_HEARTBEAT_MS;
}

/* ---------------------------------------------------------------- calls ---- */

export interface CreateCallInput {
  title?: string;
  summary: string;
  priority?: string;
  task_ref?: string;
  source?: string;
  /** Owning account — every call belongs to exactly one user. */
  user_email?: string | null;
}

export async function createCall(input: CreateCallInput): Promise<CallRow> {
  await ensureSchema();
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO calls (id, user_email, title, summary, priority, task_ref, source, status, created_at, last_activity)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'ringing', ?, ?)`,
    args: [
      id,
      input.user_email ?? null,
      input.title?.slice(0, 200) ?? "",
      input.summary.slice(0, 20_000),
      ["low", "normal", "high", "urgent"].includes(input.priority ?? "") ? input.priority! : "normal",
      input.task_ref?.slice(0, 500) ?? null,
      input.source ?? "mcp",
      now,
      now,
    ],
  });
  await addEvent(id, "summary", input.summary, { priority: input.priority ?? "normal" });
  await markRingingTimeouts();
  await broadcastEvent({ type: "call:incoming", call_id: id });
  const created = await getCall(id);
  if (!created) throw new Error("call insert failed");
  return created;
}

export async function getCall(id: string): Promise<CallRow | null> {
  await ensureSchema();
  const rs = await db.execute({ sql: "SELECT * FROM calls WHERE id = ?", args: [id] });
  const row = rs.rows[0];
  return row ? toCallRow(row as unknown as Record<string, unknown>) : null;
}

export async function listCalls(limit = 20, userEmail?: string | null): Promise<CallRow[]> {
  await ensureSchema();
  const scoped = typeof userEmail === "string" && userEmail.length > 0;
  const rs = await db.execute({
    sql: scoped
      ? "SELECT * FROM calls WHERE user_email = ? ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM calls ORDER BY created_at DESC LIMIT ?",
    args: scoped ? [userEmail, limit] : [limit],
  });
  return rs.rows.map((r) => toCallRow(r as unknown as Record<string, unknown>));
}

/**
 * Ownership check: a call is visible to its owner's account. Legacy
 * (ownerless) calls and the legacy global key keep the old open behavior.
 */
export function callVisibleTo(call: CallRow, email: string | null): boolean {
  if (!call.user_email || !email) return true; // legacy call or legacy key
  return call.user_email === email;
}

/** Flip stale ringing calls to missed. */
export async function markRingingTimeouts(): Promise<string[]> {
  await ensureSchema();
  const cutoff = Date.now() - RING_TIMEOUT_MS;
  const rs = await db.execute({
    sql: "SELECT id FROM calls WHERE status = 'ringing' AND created_at < ?",
    args: [cutoff],
  });
  const ids = rs.rows.map((r) => r.id as string);
  for (const id of ids) {
    await endCallInternal(id, "missed", "timeout");
  }
  return ids;
}

export async function setCallFields(id: string, fields: Partial<Record<string, unknown>>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const args: InValue[] = keys.map((k) => {
    const v = (fields as Record<string, unknown>)[k];
    if (v === undefined) return null;
    if (typeof v === "number" || typeof v === "string" || v === null || typeof v === "bigint") return v as InValue;
    return JSON.stringify(v);
  });
  await db.execute({
    sql: `UPDATE calls SET ${sets}, last_activity = ? WHERE id = ?`,
    args: [...args, Date.now(), id],
  });
}

export async function endCallInternal(id: string, status: CallStatus, endedBy: string): Promise<void> {
  const now = Date.now();
  await db.execute({
    sql: "UPDATE calls SET status = ?, ended_at = ?, ended_by = ?, last_activity = ? WHERE id = ? AND status NOT IN ('ended','missed','declined','failed')",
    args: [status, now, endedBy, now, id],
  });
  forgetRelayState(id);
  await addEvent(id, "system", `انتهت المكالمة (${status}) — بواسطة ${endedBy}`, { status, ended_by: endedBy });
  await broadcastEvent({ type: "call:status", call_id: id, status });
}

/* --------------------------------------------------------------- events ---- */

export async function addEvent(
  callId: string,
  kind: EventKind,
  text: string,
  meta?: Record<string, unknown>,
): Promise<CallEvent> {
  await ensureSchema();
  const now = Date.now();
  const rs = await db.execute({
    sql: "INSERT INTO call_events (call_id, kind, text, meta, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [callId, kind, text.slice(0, 20_000), meta ? JSON.stringify(meta) : null, now],
  });
  await db.execute({ sql: "UPDATE calls SET last_activity = ? WHERE id = ?", args: [now, callId] });
  return {
    seq: Number(rs.lastInsertRowid),
    call_id: callId,
    kind,
    text,
    meta: meta ? JSON.stringify(meta) : null,
    spoken: 0,
    created_at: now,
  };
}

export async function getEventsSince(callId: string, since: number, kinds?: EventKind[]): Promise<CallEvent[]> {
  await ensureSchema();
  const rs = await db.execute({
    sql: "SELECT * FROM call_events WHERE call_id = ? AND seq > ? ORDER BY seq ASC",
    args: [callId, since],
  });
  let events = rs.rows.map((r) => toEvent(r as unknown as Record<string, unknown>));
  if (kinds) events = events.filter((e) => kinds.includes(e.kind));
  return events;
}

export async function getPendingAgentUpdates(callId: string, markSpoken = true): Promise<CallEvent[]> {
  const events = (await getEventsSince(callId, 0, ["agent_update"])).filter((e) => !e.spoken);
  if (markSpoken && events.length) {
    for (const e of events) {
      await db.execute({ sql: "UPDATE call_events SET spoken = 1 WHERE seq = ?", args: [e.seq] });
    }
  }
  return events;
}

/**
 * Atomically claim the unspoken agent updates for ONE consumer — either the
 * in-turn wait loop or the browser's marker injection turn. The
 * UPDATE ... RETURNING makes the claim race-free, so exactly one consumer
 * speaks each update. Before this, both paths raced: the reply got spoken
 * once, then the losing path said "لسه مفيش رد جديد من الإيجنت" — the dead
 * line that made the call feel stuck.
 */
export async function claimAgentUpdates(callId: string): Promise<CallEvent[]> {
  await ensureSchema();
  const rs = await db.execute({
    sql: `UPDATE call_events SET spoken = 1
          WHERE call_id = ? AND kind = 'agent_update' AND spoken = 0
          RETURNING seq, call_id, kind, text, meta, spoken, created_at`,
    args: [callId],
  });
  return rs.rows.map((r) => toEvent(r as unknown as Record<string, unknown>));
}

/** wait_for_call_updates long-poll. */
export async function waitForUpdates(
  callId: string,
  since: number,
  waitMs: number,
): Promise<{ call: CallRow | null; events: CallEvent[] }> {
  const started = Date.now();
  for (;;) {
    const call = await getCall(callId);
    if (!call) return { call: null, events: [] };
    const events = await getEventsSince(callId, since);
    const ended = ["ended", "missed", "declined", "failed"].includes(call.status);
    if (events.length || ended || Date.now() - started >= waitMs) {
      await db.execute({
        sql: "UPDATE calls SET last_agent_poll = ? WHERE id = ?",
        args: [Date.now(), callId],
      });
      return { call, events };
    }
    await sleep(400);
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
