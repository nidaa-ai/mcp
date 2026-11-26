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
  user_email TEXT,
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
  user_email TEXT,
  push_json TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL,
  agent_api_key TEXT,
  fish_api_key TEXT,
  fish_agent_id TEXT,
  fish_phone_number_id TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Indexes that depend on migration-added columns — run AFTER the ALTERs. */
const INDEXES: string[] = [
  "CREATE INDEX IF NOT EXISTS idx_users_agent_key ON users(agent_api_key)",
  "CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(user_email)",
];

/** Idempotent column adds for databases created before email login. */
const MIGRATIONS: Array<[string, string]> = [
  ["devices", "ALTER TABLE devices ADD COLUMN user_email TEXT"],
  ["users_agent_api_key", "ALTER TABLE users ADD COLUMN agent_api_key TEXT"],
  ["users_fish_api_key", "ALTER TABLE users ADD COLUMN fish_api_key TEXT"],
  ["users_fish_agent_id", "ALTER TABLE users ADD COLUMN fish_agent_id TEXT"],
  ["users_fish_phone", "ALTER TABLE users ADD COLUMN fish_phone_number_id TEXT"],
  ["calls_user_email", "ALTER TABLE calls ADD COLUMN user_email TEXT"],
];

/**
 * One-time multi-tenant migration: the OLDEST user (the deployment owner)
 * inherits the global Fish credentials + agent API key from the settings
 * table, so existing connectors (ChatGPT/Claude) keep working unchanged, and
 * legacy calls are attributed to that user. Runs once, flagged in settings.
 */
async function migrateMultiuser(): Promise<void> {
  const flag = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: ["multiuser_migrated"] });
  if (flag.rows.length > 0) return;
  await db.execute(`
    UPDATE users SET
      agent_api_key = COALESCE((SELECT value FROM settings WHERE key = 'agent_api_key'), agent_api_key),
      fish_api_key = COALESCE((SELECT value FROM settings WHERE key = 'fish_api_key'), fish_api_key),
      fish_agent_id = COALESCE((SELECT value FROM settings WHERE key = 'fish_agent_id'), fish_agent_id),
      fish_phone_number_id = COALESCE((SELECT value FROM settings WHERE key = 'fish_phone_number_id'), fish_phone_number_id)
    WHERE email = (SELECT email FROM users ORDER BY created_at ASC LIMIT 1)
  `);
  await db.execute(`
    UPDATE calls SET user_email = (SELECT email FROM users ORDER BY created_at ASC LIMIT 1)
    WHERE user_email IS NULL
  `);
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES ('multiuser_migrated', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
    args: [],
  });
}

export function ensureSchema(): Promise<void> {
  if (!globalForDb.schemaReady) {
    globalForDb.schemaReady = (async () => {
      for (const stmt of SCHEMA.split(";")) {
        const s = stmt.trim();
        if (s) await db.execute(s);
      }
      for (const [, ddl] of MIGRATIONS) {
        try {
          await db.execute(ddl);
        } catch {
          /* column already exists */
        }
      }
      for (const ddl of INDEXES) {
        try {
          await db.execute(ddl);
        } catch {
          /* index may already exist or column still missing */
        }
      }
      try {
        await migrateMultiuser();
      } catch {
        /* retried on next cold start until the flag lands */
      }
    })();
  }
  return globalForDb.schemaReady;
}
