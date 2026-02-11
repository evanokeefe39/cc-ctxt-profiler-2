import { Database } from 'bun:sqlite';

const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_state (
  file_path   TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  remainder   TEXT NOT NULL DEFAULT '',
  last_mtime  REAL NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  project_key  TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  project_key    TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  file_path      TEXT,
  start_time     TEXT,
  end_time       TEXT,
  total_turns    INTEGER NOT NULL DEFAULT 0,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  mtime          REAL NOT NULL DEFAULT 0,
  overall_health TEXT,
  PRIMARY KEY (project_key, session_id)
);

CREATE TABLE IF NOT EXISTS agents (
  project_key    TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  file_path      TEXT,
  model          TEXT,
  label          TEXT,
  context_limit  INTEGER,
  profile_id     TEXT,
  total_turns    INTEGER NOT NULL DEFAULT 0,
  peak_pct       REAL NOT NULL DEFAULT 0,
  final_pct      REAL NOT NULL DEFAULT 0,
  avg_context_pct REAL NOT NULL DEFAULT 0,
  health         TEXT,
  PRIMARY KEY (project_key, session_id, agent_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                   TEXT NOT NULL,
  parent_uuid            TEXT,
  session_id             TEXT NOT NULL,
  project_key            TEXT NOT NULL,
  agent_id               TEXT NOT NULL,
  timestamp              TEXT NOT NULL,
  type                   TEXT NOT NULL,
  model                  TEXT,
  input_tokens           INTEGER,
  output_tokens          INTEGER,
  cache_creation_tokens  INTEGER,
  cache_read_tokens      INTEGER,
  abs_tokens             INTEGER,
  pct                    REAL,
  is_sidechain           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id),
  tool_use_id TEXT,
  tool_name   TEXT,
  is_error    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS diagnostic_events (
  id          TEXT PRIMARY KEY,
  timestamp   TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  project_key TEXT NOT NULL,
  profile_id  TEXT,
  severity    TEXT NOT NULL,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  data        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_mtime ON sessions(mtime DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_unique ON messages(project_key, session_id, agent_id, uuid);
CREATE INDEX IF NOT EXISTS idx_messages_agent_ts ON messages(project_key, session_id, agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_events_session ON diagnostic_events(project_key, session_id, agent_id);
`;

/**
 * Initialize the database schema: WAL mode, pragmas, and all tables/indexes.
 */
export function ensureSchema(db: Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(DDL);

  // Write schema version
  db.run(
    `INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)`,
    [String(SCHEMA_VERSION)],
  );
}

export { SCHEMA_VERSION };
