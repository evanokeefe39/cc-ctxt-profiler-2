import { Database } from 'bun:sqlite';
import { detectCompactions } from '../parser/compaction-detector.js';
import { MODEL_LIMITS, DEFAULT_CONTEXT_LIMIT, FALLBACK_THRESHOLDS, DEFAULT_ALERTS } from '../schemas/constants.js';
import { extractModelFamily } from '../profiles/matcher.js';
import type { AgentTimeSeries, DiagnosticEvent, TimeSeriesPoint } from '../schemas/index.js';

export interface DbSessionListEntry {
  projectKey: string;
  projectName: string;
  sessionId: string;
  mtime: Date;
  sizeBytes: number;
  agentCount: number;
  overallHealth: string | null;
  totalTurns: number;
  startTime: string | null;
  endTime: string | null;
}

/**
 * List all sessions across all projects, sorted by mtime DESC.
 */
export function listSessions(db: Database): DbSessionListEntry[] {
  const rows = db.query<{
    project_key: string;
    project_name: string;
    session_id: string;
    mtime: number;
    size_bytes: number;
    agent_count: number;
    overall_health: string | null;
    total_turns: number;
    start_time: string | null;
    end_time: string | null;
  }, []>(`
    SELECT
      s.project_key,
      p.project_name,
      s.session_id,
      s.mtime,
      s.size_bytes,
      COALESCE((SELECT COUNT(*) FROM agents a WHERE a.project_key = s.project_key AND a.session_id = s.session_id), 0) AS agent_count,
      s.overall_health,
      s.total_turns,
      s.start_time,
      s.end_time
    FROM sessions s
    JOIN projects p ON p.project_key = s.project_key
    ORDER BY s.mtime DESC
  `).all();

  return rows.map((r) => ({
    projectKey: r.project_key,
    projectName: r.project_name,
    sessionId: r.session_id,
    mtime: new Date(r.mtime),
    sizeBytes: r.size_bytes,
    agentCount: r.agent_count,
    overallHealth: r.overall_health,
    totalTurns: r.total_turns,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
}

/**
 * List sessions for a specific project.
 */
export function listSessionsByProject(db: Database, projectKey: string): DbSessionListEntry[] {
  const rows = db.query<{
    project_key: string;
    project_name: string;
    session_id: string;
    mtime: number;
    size_bytes: number;
    agent_count: number;
    overall_health: string | null;
    total_turns: number;
    start_time: string | null;
    end_time: string | null;
  }, [string]>(`
    SELECT
      s.project_key,
      p.project_name,
      s.session_id,
      s.mtime,
      s.size_bytes,
      COALESCE((SELECT COUNT(*) FROM agents a WHERE a.project_key = s.project_key AND a.session_id = s.session_id), 0) AS agent_count,
      s.overall_health,
      s.total_turns,
      s.start_time,
      s.end_time
    FROM sessions s
    JOIN projects p ON p.project_key = s.project_key
    WHERE s.project_key = ?
    ORDER BY s.mtime DESC
  `).all(projectKey);

  return rows.map((r) => ({
    projectKey: r.project_key,
    projectName: r.project_name,
    sessionId: r.session_id,
    mtime: new Date(r.mtime),
    sizeBytes: r.size_bytes,
    agentCount: r.agent_count,
    overallHealth: r.overall_health,
    totalTurns: r.total_turns,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
}

/**
 * Reconstruct AgentTimeSeries[] for a session from SQLite data.
 */
export function getSessionAgents(
  db: Database,
  projectKey: string,
  sessionId: string,
): AgentTimeSeries[] {
  const agentRows = db.query<{
    agent_id: string;
    model: string | null;
    label: string | null;
    context_limit: number | null;
  }, [string, string]>(
    `SELECT agent_id, model, label, context_limit FROM agents
     WHERE project_key = ? AND session_id = ?`,
  ).all(projectKey, sessionId);

  const results: AgentTimeSeries[] = [];

  for (const agent of agentRows) {
    const model = agent.model ?? 'unknown';
    const limit = agent.context_limit ?? MODEL_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;

    // Get assistant messages with computed tokens
    const msgRows = db.query<{
      timestamp: string;
      abs_tokens: number;
      pct: number;
    }, [string, string, string]>(
      `SELECT timestamp, abs_tokens, pct FROM messages
       WHERE project_key = ? AND session_id = ? AND agent_id = ?
         AND type = 'assistant' AND abs_tokens IS NOT NULL
       ORDER BY timestamp ASC`,
    ).all(projectKey, sessionId, agent.agent_id);

    const points: TimeSeriesPoint[] = msgRows.map((m) => ({
      t: m.timestamp,
      abs: m.abs_tokens,
      pct: m.pct,
    }));

    const compactions = detectCompactions(points);

    // Determine thresholds from model family
    const family = extractModelFamily(model);
    const thresholds = family && family in FALLBACK_THRESHOLDS
      ? FALLBACK_THRESHOLDS[family as keyof typeof FALLBACK_THRESHOLDS]
      : DEFAULT_ALERTS;

    results.push({
      agentId: agent.agent_id,
      model,
      label: agent.label ?? agent.agent_id,
      limit,
      threshold: thresholds.dumbZoneThreshold,
      warningThreshold: thresholds.warningThreshold,
      points,
      compactions,
    });
  }

  return results;
}

/**
 * Get diagnostic events for a session (from the live monitor persistent store).
 */
export function getSessionEvents(
  db: Database,
  projectKey: string,
  sessionId: string,
): DiagnosticEvent[] {
  const rows = db.query<{
    id: string;
    timestamp: string;
    agent_id: string;
    profile_id: string | null;
    severity: string;
    type: string;
    message: string;
    data: string | null;
  }, [string, string]>(
    `SELECT id, timestamp, agent_id, profile_id, severity, type, message, data
     FROM diagnostic_events
     WHERE project_key = ? AND session_id = ?
     ORDER BY timestamp ASC`,
  ).all(projectKey, sessionId);

  return rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    agentId: r.agent_id,
    profileId: r.profile_id ?? undefined,
    severity: r.severity as DiagnosticEvent['severity'],
    type: r.type as DiagnosticEvent['type'],
    message: r.message,
    data: r.data ? JSON.parse(r.data) : undefined,
  }));
}

/**
 * Get tool call statistics for an agent.
 */
export function getAgentToolStats(
  db: Database,
  projectKey: string,
  sessionId: string,
  agentId: string,
): { toolCallCount: number; toolErrorCount: number; toolErrorRate: number } {
  const row = db.query<{
    total: number;
    errors: number;
  }, [string, string, string]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN tc.is_error = 1 THEN 1 ELSE 0 END) AS errors
     FROM tool_calls tc
     JOIN messages m ON m.id = tc.message_id
     WHERE m.project_key = ? AND m.session_id = ? AND m.agent_id = ?`,
  ).get(projectKey, sessionId, agentId);

  const total = row?.total ?? 0;
  const errors = row?.errors ?? 0;
  return {
    toolCallCount: total,
    toolErrorCount: errors,
    toolErrorRate: total > 0 ? errors / total : 0,
  };
}

/**
 * Check if a session exists in the database.
 */
export interface DbProjectListEntry {
  projectKey: string;
  projectName: string;
  sessionCount: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  lastActivity: Date;
  totalTurns: number;
}

/**
 * List all projects with aggregate stats.
 */
export function listProjects(db: Database): DbProjectListEntry[] {
  const rows = db.query<{
    project_key: string;
    project_name: string;
    session_count: number;
    healthy_count: number;
    degraded_count: number;
    unhealthy_count: number;
    last_activity: number;
    total_turns: number;
  }, []>(`
    SELECT
      p.project_key,
      p.project_name,
      COUNT(s.session_id) AS session_count,
      SUM(CASE WHEN s.overall_health = 'healthy' THEN 1 ELSE 0 END) AS healthy_count,
      SUM(CASE WHEN s.overall_health = 'degraded' THEN 1 ELSE 0 END) AS degraded_count,
      SUM(CASE WHEN s.overall_health = 'unhealthy' THEN 1 ELSE 0 END) AS unhealthy_count,
      MAX(s.mtime) AS last_activity,
      SUM(s.total_turns) AS total_turns
    FROM projects p
    LEFT JOIN sessions s ON s.project_key = p.project_key
    GROUP BY p.project_key
    ORDER BY last_activity DESC
  `).all();

  return rows.map((r) => ({
    projectKey: r.project_key,
    projectName: r.project_name,
    sessionCount: r.session_count,
    healthyCount: r.healthy_count,
    degradedCount: r.degraded_count,
    unhealthyCount: r.unhealthy_count,
    lastActivity: new Date(r.last_activity ?? 0),
    totalTurns: r.total_turns ?? 0,
  }));
}

export interface DbMessageEntry {
  timestamp: string;
  type: string;
  model: string | null;
  uuid: string;
  inputTokens: number | null;
  outputTokens: number | null;
  absTokens: number | null;
  pct: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
}

/**
 * Get all messages for an agent, ordered by timestamp.
 */
export function getSessionMessages(
  db: Database,
  projectKey: string,
  sessionId: string,
  agentId: string,
): DbMessageEntry[] {
  const rows = db.query<{
    timestamp: string;
    type: string;
    model: string | null;
    uuid: string;
    input_tokens: number | null;
    output_tokens: number | null;
    abs_tokens: number | null;
    pct: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
  }, [string, string, string]>(`
    SELECT timestamp, type, model, uuid, input_tokens, output_tokens,
           abs_tokens, pct, cache_creation_tokens, cache_read_tokens
    FROM messages
    WHERE project_key = ? AND session_id = ? AND agent_id = ?
    ORDER BY timestamp ASC
  `).all(projectKey, sessionId, agentId);

  return rows.map((r) => ({
    timestamp: r.timestamp,
    type: r.type,
    model: r.model,
    uuid: r.uuid,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    absTokens: r.abs_tokens,
    pct: r.pct,
    cacheCreationTokens: r.cache_creation_tokens,
    cacheReadTokens: r.cache_read_tokens,
  }));
}

export interface DbToolCallEntry {
  toolName: string | null;
  isError: boolean;
  toolUseId: string | null;
  timestamp: string;
  agentId: string;
}

/**
 * Get tool calls for a session, optionally filtered by agent.
 */
export function getSessionToolCalls(
  db: Database,
  projectKey: string,
  sessionId: string,
  agentId?: string,
): DbToolCallEntry[] {
  const sql = `
    SELECT tc.tool_name, tc.is_error, tc.tool_use_id, m.timestamp, m.agent_id
    FROM tool_calls tc
    JOIN messages m ON m.id = tc.message_id
    WHERE m.project_key = ? AND m.session_id = ?
    ${agentId ? 'AND m.agent_id = ?' : ''}
    ORDER BY m.timestamp ASC
  `;
  const params: string[] = [projectKey, sessionId];
  if (agentId) params.push(agentId);

  const rows = db.query<{
    tool_name: string | null;
    is_error: number;
    tool_use_id: string | null;
    timestamp: string;
    agent_id: string;
  }, string[]>(sql).all(...params);

  return rows.map((r) => ({
    toolName: r.tool_name,
    isError: r.is_error === 1,
    toolUseId: r.tool_use_id,
    timestamp: r.timestamp,
    agentId: r.agent_id,
  }));
}

export function sessionExists(
  db: Database,
  projectKey: string,
  sessionId: string,
): boolean {
  const row = db.query<{ c: number }, [string, string]>(
    `SELECT COUNT(*) AS c FROM sessions WHERE project_key = ? AND session_id = ?`,
  ).get(projectKey, sessionId);
  return (row?.c ?? 0) > 0;
}
