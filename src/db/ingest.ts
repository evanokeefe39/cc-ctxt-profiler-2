import { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { readJsonlIncremental } from '../parser/jsonl-reader.js';
import { computeUsedTokens } from '../parser/token-calculator.js';
import {
  discoverSessions,
  findProjectSessionDirs,
  decodeProjectName,
} from '../parser/session-discovery.js';
import { MODEL_LIMITS, DEFAULT_CONTEXT_LIMIT } from '../schemas/constants.js';
import type { TranscriptLine, DiagnosticEvent } from '../schemas/index.js';

/**
 * Ingest all projects under a projects directory into SQLite.
 * Returns total number of new messages inserted.
 */
export function ingestAll(
  db: Database,
  projectsDir: string,
  opts?: { fullRescan?: boolean },
): number {
  const projectDirs = findProjectSessionDirs(projectsDir);
  let totalNew = 0;

  for (const projectDir of projectDirs) {
    const projectKey = basename(projectDir);
    const projectName = decodeProjectName(projectKey);

    // Upsert project
    db.run(
      `INSERT INTO projects (project_key, project_name) VALUES (?, ?)
       ON CONFLICT(project_key) DO UPDATE SET project_name = excluded.project_name`,
      [projectKey, projectName],
    );

    const sessions = discoverSessions(projectDir);

    for (const session of sessions) {
      // Upsert session
      let sizeBytes = 0;
      try { sizeBytes += statSync(session.sessionFile).size; } catch { /* ignore */ }
      for (const af of session.agentFiles) {
        try { sizeBytes += statSync(af).size; } catch { /* ignore */ }
      }

      db.run(
        `INSERT INTO sessions (project_key, session_id, file_path, mtime, size_bytes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_key, session_id) DO UPDATE SET
           mtime = excluded.mtime,
           size_bytes = excluded.size_bytes`,
        [projectKey, session.sessionId, session.sessionFile, session.mtime.getTime(), sizeBytes],
      );

      // Ingest main session file
      const mainLabel = 'Main session';
      const mainLines = ingestFile(
        db, session.sessionFile, projectKey, session.sessionId, session.sessionId, mainLabel, opts?.fullRescan,
      );
      totalNew += mainLines.length;

      // Ingest agent files
      for (const agentFile of session.agentFiles) {
        const agentId = basename(agentFile, '.jsonl');
        const agentLines = ingestFile(
          db, agentFile, projectKey, session.sessionId, agentId, agentId, opts?.fullRescan,
        );
        totalNew += agentLines.length;
      }

      // Update session aggregate stats
      updateSessionStats(db, projectKey, session.sessionId);
    }
  }

  return totalNew;
}

/**
 * Ingest a single JSONL file incrementally.
 * Returns the newly parsed transcript lines.
 */
export function ingestFile(
  db: Database,
  filePath: string,
  projectKey: string,
  sessionId: string,
  agentId: string,
  label: string,
  fullRescan?: boolean,
): TranscriptLine[] {
  // Check ingest state
  const state = db.query<{ byte_offset: number; remainder: string; last_mtime: number }, [string]>(
    `SELECT byte_offset, remainder, last_mtime FROM ingest_state WHERE file_path = ?`,
  ).get(filePath);

  let mtime: number;
  try {
    mtime = statSync(filePath).mtimeMs;
  } catch {
    return [];
  }

  // Skip if mtime unchanged and not a full rescan
  if (state && !fullRescan && state.last_mtime >= mtime) {
    return [];
  }

  const byteOffset = fullRescan ? 0 : (state?.byte_offset ?? 0);
  const remainder = fullRescan ? '' : (state?.remainder ?? '');

  const result = readJsonlIncremental(filePath, byteOffset, remainder);

  if (result.lines.length > 0) {
    insertLines(db, result.lines, projectKey, sessionId, agentId);

    // Upsert agent
    const model = resolveModelFromLines(result.lines);
    const limit = MODEL_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
    db.run(
      `INSERT INTO agents (project_key, session_id, agent_id, file_path, model, label, context_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_key, session_id, agent_id) DO UPDATE SET
         model = COALESCE(excluded.model, agents.model),
         label = excluded.label,
         context_limit = excluded.context_limit`,
      [projectKey, sessionId, agentId, filePath, model, label, limit],
    );

    updateAgentStats(db, projectKey, sessionId, agentId);
  }

  // Update ingest state
  db.run(
    `INSERT INTO ingest_state (file_path, byte_offset, remainder, last_mtime, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(file_path) DO UPDATE SET
       byte_offset = excluded.byte_offset,
       remainder = excluded.remainder,
       last_mtime = excluded.last_mtime,
       updated_at = excluded.updated_at`,
    [filePath, result.bytesRead, result.remainder, mtime],
  );

  return result.lines;
}

/**
 * Insert parsed transcript lines into the messages table.
 * Extracts tool_use blocks from assistant messages into tool_calls table.
 */
export function insertLines(
  db: Database,
  lines: TranscriptLine[],
  projectKey: string,
  sessionId: string,
  agentId: string,
): void {
  const insertMsg = db.prepare(
    `INSERT INTO messages (uuid, parent_uuid, session_id, project_key, agent_id, timestamp, type, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, abs_tokens, pct, is_sidechain)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_key, session_id, agent_id, uuid) DO UPDATE SET
       output_tokens = CASE WHEN excluded.output_tokens > messages.output_tokens THEN excluded.output_tokens ELSE messages.output_tokens END,
       abs_tokens = CASE WHEN excluded.output_tokens > messages.output_tokens THEN excluded.abs_tokens ELSE messages.abs_tokens END,
       pct = CASE WHEN excluded.output_tokens > messages.output_tokens THEN excluded.pct ELSE messages.pct END`,
  );

  const insertToolCall = db.prepare(
    `INSERT INTO tool_calls (message_id, tool_use_id, tool_name, is_error)
     VALUES (?, ?, ?, 0)`,
  );

  // Build a lookup of tool_use_ids from this batch to match with tool_result errors
  const toolUseMessageIds = new Map<string, number>();

  const transaction = db.transaction(() => {
    for (const line of lines) {
      const usage = line.message.usage;
      let absTokens: number | null = null;
      let pct: number | null = null;

      if (usage && line.type === 'assistant') {
        absTokens = computeUsedTokens(usage);
        // Look up agent context limit
        const agent = db.query<{ context_limit: number }, [string, string, string]>(
          `SELECT context_limit FROM agents WHERE project_key = ? AND session_id = ? AND agent_id = ?`,
        ).get(projectKey, sessionId, agentId);
        const limit = agent?.context_limit ?? DEFAULT_CONTEXT_LIMIT;
        pct = absTokens / limit;
      }

      insertMsg.run(
        line.uuid,
        line.parentUuid ?? null,
        sessionId,
        projectKey,
        agentId,
        line.timestamp,
        line.type,
        line.message.model ?? null,
        usage?.input_tokens ?? null,
        usage?.output_tokens ?? null,
        usage?.cache_creation_input_tokens ?? null,
        usage?.cache_read_input_tokens ?? null,
        absTokens,
        pct,
        line.isSidechain ? 1 : 0,
      );

      // Get the message id (last inserted or existing)
      const msgRow = db.query<{ id: number }, [string, string, string, string]>(
        `SELECT id FROM messages WHERE project_key = ? AND session_id = ? AND agent_id = ? AND uuid = ?`,
      ).get(projectKey, sessionId, agentId, line.uuid);
      const messageId = msgRow!.id;

      // Extract tool_use blocks from assistant messages
      if (line.type === 'assistant' && Array.isArray(line.message.content)) {
        for (const block of line.message.content) {
          if (block && typeof block === 'object' && block.type === 'tool_use') {
            insertToolCall.run(messageId, block.id ?? null, block.name ?? null);
            if (block.id) {
              toolUseMessageIds.set(block.id, messageId);
            }
          }
        }
      }

      // Match tool_result errors from user messages
      if (line.type === 'user' && Array.isArray(line.message.content)) {
        for (const block of line.message.content) {
          if (
            block &&
            typeof block === 'object' &&
            block.type === 'tool_result' &&
            block.is_error === true &&
            block.tool_use_id
          ) {
            // Update the tool_call record to mark as error
            db.run(
              `UPDATE tool_calls SET is_error = 1
               WHERE tool_use_id = ? AND message_id IN (
                 SELECT id FROM messages WHERE project_key = ? AND session_id = ? AND agent_id = ?
               )`,
              [block.tool_use_id, projectKey, sessionId, agentId],
            );
          }
        }
      }
    }
  });

  transaction();
}

/**
 * Insert diagnostic events into the diagnostic_events table.
 */
export function insertEvents(
  db: Database,
  events: DiagnosticEvent[],
  projectKey: string,
  sessionId: string,
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO diagnostic_events (id, timestamp, agent_id, session_id, project_key, profile_id, severity, type, message, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const transaction = db.transaction(() => {
    for (const event of events) {
      insert.run(
        event.id,
        event.timestamp,
        event.agentId,
        sessionId,
        projectKey,
        event.profileId ?? null,
        event.severity,
        event.type,
        event.message,
        event.data ? JSON.stringify(event.data) : null,
      );
    }
  });

  transaction();
}

/**
 * Recompute aggregate stats for an agent from the messages table.
 */
export function updateAgentStats(
  db: Database,
  projectKey: string,
  sessionId: string,
  agentId: string,
): void {
  db.run(
    `UPDATE agents SET
       total_turns = (
         SELECT COUNT(*) FROM messages
         WHERE project_key = ? AND session_id = ? AND agent_id = ? AND type = 'assistant' AND abs_tokens IS NOT NULL
       ),
       peak_pct = COALESCE((
         SELECT MAX(pct) FROM messages
         WHERE project_key = ? AND session_id = ? AND agent_id = ? AND type = 'assistant' AND pct IS NOT NULL
       ), 0),
       final_pct = COALESCE((
         SELECT pct FROM messages
         WHERE project_key = ? AND session_id = ? AND agent_id = ? AND type = 'assistant' AND pct IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1
       ), 0),
       avg_context_pct = COALESCE((
         SELECT AVG(pct) FROM messages
         WHERE project_key = ? AND session_id = ? AND agent_id = ? AND type = 'assistant' AND pct IS NOT NULL
       ), 0)
     WHERE project_key = ? AND session_id = ? AND agent_id = ?`,
    [
      projectKey, sessionId, agentId,
      projectKey, sessionId, agentId,
      projectKey, sessionId, agentId,
      projectKey, sessionId, agentId,
      projectKey, sessionId, agentId,
    ],
  );
}

/**
 * Recompute aggregate stats for a session from agents table.
 */
export function updateSessionStats(
  db: Database,
  projectKey: string,
  sessionId: string,
): void {
  db.run(
    `UPDATE sessions SET
       total_turns = COALESCE((
         SELECT SUM(total_turns) FROM agents
         WHERE project_key = ? AND session_id = ?
       ), 0),
       start_time = (
         SELECT MIN(timestamp) FROM messages
         WHERE project_key = ? AND session_id = ? AND type = 'assistant'
       ),
       end_time = (
         SELECT MAX(timestamp) FROM messages
         WHERE project_key = ? AND session_id = ? AND type = 'assistant'
       ),
       overall_health = (
         SELECT CASE
           WHEN EXISTS(SELECT 1 FROM agents WHERE project_key = ? AND session_id = ? AND health = 'unhealthy') THEN 'unhealthy'
           WHEN EXISTS(SELECT 1 FROM agents WHERE project_key = ? AND session_id = ? AND health = 'degraded') THEN 'degraded'
           ELSE 'healthy'
         END
       )
     WHERE project_key = ? AND session_id = ?`,
    [
      projectKey, sessionId,
      projectKey, sessionId,
      projectKey, sessionId,
      projectKey, sessionId,
      projectKey, sessionId,
      projectKey, sessionId,
    ],
  );
}

function resolveModelFromLines(lines: TranscriptLine[]): string {
  for (const line of lines) {
    if (line.message.model) return line.message.model;
  }
  return 'unknown';
}
