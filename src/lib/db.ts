import { createClient, type Client, type InValue } from "@libsql/client";
import { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from "./env";

/**
 * Turso (libsql) client shared across route handlers.
 * Falls back to a local file so `bun run dev` still boots without Turso.
 */
const globalForDb = globalThis as unknown as { turso?: Client; schemaReady?: Promise<void> };

function createTurso(): Client {
  if (TURSO_DATABASE_URL) {
    return createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
  }
  return createClient({ url: "file:local.db" });
}

export const db = globalForDb.turso ?? createTurso();
if (process.env.NODE_ENV !== "production") globalForDb.turso = db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  task_ref TEXT,
  source TEXT NOT NULL DEFAULT 'mcp',
  status TEXT NOT NULL DEFAULT 'ringing',
  fish_session_id TEXT,
  fish_session_json TEXT,
  first_message TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at INTEGER,
  ended_by TEXT,
  last_activity INTEGER,
  last_agent_poll INTEGER,
  last_user_idx INTEGER NOT NULL DEFAULT -1,
  last_user_hash TEXT NOT NULL DEFAULT '',
  transcript_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE TABLE IF NOT EXISTS call_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  meta TEXT,
  spoken INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_call ON call_events(call_id, seq);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  push_json TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function ensureSchema(): Promise<void> {
  if (!globalForDb.schemaReady) {
    globalForDb.schemaReady = (async () => {
      for (const stmt of SCHEMA.split(";")) {
        const s = stmt.trim();
        if (s) await db.execute(s);
      }
    })();
  }
  return globalForDb.schemaReady;
}
