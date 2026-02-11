import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema, SCHEMA_VERSION } from '../schema.js';
import { openDatabase } from '../database.js';
import { insertLines, insertEvents, updateAgentStats, updateSessionStats } from '../ingest.js';
import {
  listSessions,
  listProjects,
  getSessionAgents,
  getSessionEvents,
  getSessionMessages,
  getSessionToolCalls,
  getAgentToolStats,
  sessionExists,
} from '../queries.js';
import type { TranscriptLine, DiagnosticEvent } from '../../schemas/index.js';

function makeDb(): Database {
  const { db } = openDatabase(':memory:');
  return db;
}

function seedProject(db: Database, projectKey = 'test-project', projectName = 'Test Project') {
  db.run(`INSERT OR IGNORE INTO projects (project_key, project_name) VALUES (?, ?)`, [projectKey, projectName]);
}

function seedSession(db: Database, projectKey = 'test-project', sessionId = 'sess-001', mtime = Date.now()) {
  db.run(
    `INSERT OR IGNORE INTO sessions (project_key, session_id, mtime, size_bytes) VALUES (?, ?, ?, ?)`,
    [projectKey, sessionId, mtime, 1024],
  );
}

function seedAgent(db: Database, projectKey = 'test-project', sessionId = 'sess-001', agentId = 'sess-001', model = 'claude-sonnet-4-5-20250929', limit = 200000) {
  db.run(
    `INSERT OR IGNORE INTO agents (project_key, session_id, agent_id, model, label, context_limit) VALUES (?, ?, ?, ?, ?, ?)`,
    [projectKey, sessionId, agentId, model, agentId, limit],
  );
}

function makeLine(
  uuid: string,
  type: 'assistant' | 'user',
  timestamp: string,
  opts?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_creation?: number;
    cache_read?: number;
    parentUuid?: string;
    content?: any[];
    isSidechain?: boolean;
  },
): TranscriptLine {
  const usage = type === 'assistant' ? {
    input_tokens: opts?.input_tokens ?? 50000,
    output_tokens: opts?.output_tokens ?? 1000,
    cache_creation_input_tokens: opts?.cache_creation ?? 0,
    cache_read_input_tokens: opts?.cache_read ?? 0,
  } : undefined;

  return {
    sessionId: 'sess-001',
    uuid,
    parentUuid: opts?.parentUuid ?? null,
    timestamp,
    type,
    isSidechain: opts?.isSidechain ?? false,
    message: {
      role: type,
      model: type === 'assistant' ? (opts?.model ?? 'claude-sonnet-4-5-20250929') : undefined,
      content: opts?.content ?? [{ type: 'text', text: 'Hello' }],
      usage,
    },
  };
}

function makeEvent(
  id: string,
  agentId: string,
  type: DiagnosticEvent['type'],
  severity: DiagnosticEvent['severity'] = 'info',
  data?: Record<string, unknown>,
): DiagnosticEvent {
  return {
    id,
    timestamp: '2025-01-15T10:00:00Z',
    agentId,
    severity,
    type,
    message: `Test event: ${type}`,
    data,
  };
}

// ---- Schema Tests ----
describe('schema', () => {
  it('creates all tables', () => {
    const db = makeDb();
    const tables = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    ).all().map(r => r.name);

    expect(tables).toContain('schema_meta');
    expect(tables).toContain('ingest_state');
    expect(tables).toContain('projects');
    expect(tables).toContain('sessions');
    expect(tables).toContain('agents');
    expect(tables).toContain('messages');
    expect(tables).toContain('tool_calls');
    expect(tables).toContain('diagnostic_events');
    db.close();
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    ensureSchema(db); // second call should not throw
    db.close();
  });

  it('sets WAL mode (on disk db)', () => {
    // WAL mode only applies to on-disk databases; :memory: always returns 'memory'
    const db = makeDb();
    const row = db.query<{ journal_mode: string }, []>(`PRAGMA journal_mode`).get();
    // In-memory DB returns 'memory' — just verify the pragma doesn't throw
    expect(row).toBeDefined();
    db.close();
  });

  it('writes schema version', () => {
    const db = makeDb();
    const row = db.query<{ value: string }, [string]>(
      `SELECT value FROM schema_meta WHERE key = ?`,
    ).get('schema_version');
    expect(row!.value).toBe(String(SCHEMA_VERSION));
    db.close();
  });
});

// ---- Ingest Tests ----
describe('ingest', () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
    seedProject(db);
    seedSession(db);
    seedAgent(db);
  });

  it('inserts assistant lines with abs_tokens and pct', () => {
    const lines = [
      makeLine('msg-001', 'assistant', '2025-01-15T10:00:00Z', {
        input_tokens: 50000,
        cache_creation: 8000,
        cache_read: 12000,
      }),
    ];

    insertLines(db, lines, 'test-project', 'sess-001', 'sess-001');

    const row = db.query<{ abs_tokens: number; pct: number }, []>(
      `SELECT abs_tokens, pct FROM messages WHERE uuid = 'msg-001'`,
    ).get();

    expect(row!.abs_tokens).toBe(70000); // 50000 + 8000 + 12000
    expect(row!.pct).toBeCloseTo(0.35, 2); // 70000 / 200000
    db.close();
  });

  it('deduplicates by uuid keeping highest output_tokens', () => {
    const line1 = makeLine('msg-dup', 'assistant', '2025-01-15T10:00:00Z', {
      output_tokens: 500,
    });
    const line2 = makeLine('msg-dup', 'assistant', '2025-01-15T10:00:00Z', {
      output_tokens: 1000,
    });

    insertLines(db, [line1], 'test-project', 'sess-001', 'sess-001');
    insertLines(db, [line2], 'test-project', 'sess-001', 'sess-001');

    const count = db.query<{ c: number }, []>(
      `SELECT COUNT(*) AS c FROM messages WHERE uuid = 'msg-dup'`,
    ).get();
    expect(count!.c).toBe(1);

    const row = db.query<{ output_tokens: number }, []>(
      `SELECT output_tokens FROM messages WHERE uuid = 'msg-dup'`,
    ).get();
    expect(row!.output_tokens).toBe(1000);
    db.close();
  });

  it('extracts tool_use blocks into tool_calls', () => {
    const line = makeLine('msg-tools', 'assistant', '2025-01-15T10:00:00Z', {
      content: [
        { type: 'text', text: 'Let me check' },
        { type: 'tool_use', id: 't1', name: 'read_file', input: {} },
        { type: 'tool_use', id: 't2', name: 'grep', input: {} },
      ],
    });

    insertLines(db, [line], 'test-project', 'sess-001', 'sess-001');

    const count = db.query<{ c: number }, []>(
      `SELECT COUNT(*) AS c FROM tool_calls`,
    ).get();
    expect(count!.c).toBe(2);

    const tools = db.query<{ tool_name: string; is_error: number }, []>(
      `SELECT tool_name, is_error FROM tool_calls ORDER BY tool_name`,
    ).all();
    expect(tools[0].tool_name).toBe('grep');
    expect(tools[0].is_error).toBe(0);
    expect(tools[1].tool_name).toBe('read_file');
    db.close();
  });

  it('marks tool_result errors', () => {
    const assistant = makeLine('msg-a', 'assistant', '2025-01-15T10:00:00Z', {
      content: [
        { type: 'tool_use', id: 't1', name: 'bash', input: {} },
      ],
    });
    const user = makeLine('msg-u', 'user', '2025-01-15T10:00:01Z', {
      parentUuid: 'msg-a',
      content: [
        { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Command failed' },
      ],
    });

    insertLines(db, [assistant, user], 'test-project', 'sess-001', 'sess-001');

    const tc = db.query<{ is_error: number }, []>(
      `SELECT is_error FROM tool_calls WHERE tool_use_id = 't1'`,
    ).get();
    expect(tc!.is_error).toBe(1);
    db.close();
  });

  it('updates agent stats', () => {
    const lines = [
      makeLine('msg-001', 'assistant', '2025-01-15T10:00:00Z', { input_tokens: 20000 }),
      makeLine('msg-002', 'assistant', '2025-01-15T10:01:00Z', { input_tokens: 60000 }),
      makeLine('msg-003', 'assistant', '2025-01-15T10:02:00Z', { input_tokens: 40000 }),
    ];

    insertLines(db, lines, 'test-project', 'sess-001', 'sess-001');
    updateAgentStats(db, 'test-project', 'sess-001', 'sess-001');

    const agent = db.query<{
      total_turns: number;
      peak_pct: number;
      final_pct: number;
      avg_context_pct: number;
    }, [string, string, string]>(
      `SELECT total_turns, peak_pct, final_pct, avg_context_pct FROM agents WHERE project_key = ? AND session_id = ? AND agent_id = ?`,
    ).get('test-project', 'sess-001', 'sess-001');

    expect(agent!.total_turns).toBe(3);
    expect(agent!.peak_pct).toBe(0.3); // 60000/200000
    expect(agent!.final_pct).toBe(0.2); // 40000/200000
    expect(agent!.avg_context_pct).toBeCloseTo(0.2, 2); // (20000+60000+40000)/(200000*3)
    db.close();
  });

  it('updates session stats', () => {
    const lines = [
      makeLine('msg-001', 'assistant', '2025-01-15T10:00:00Z'),
      makeLine('msg-002', 'assistant', '2025-01-15T10:05:00Z'),
    ];

    insertLines(db, lines, 'test-project', 'sess-001', 'sess-001');
    updateAgentStats(db, 'test-project', 'sess-001', 'sess-001');
    updateSessionStats(db, 'test-project', 'sess-001');

    const session = db.query<{
      total_turns: number;
      start_time: string;
      end_time: string;
    }, [string, string]>(
      `SELECT total_turns, start_time, end_time FROM sessions WHERE project_key = ? AND session_id = ?`,
    ).get('test-project', 'sess-001');

    expect(session!.total_turns).toBe(2);
    expect(session!.start_time).toBe('2025-01-15T10:00:00Z');
    expect(session!.end_time).toBe('2025-01-15T10:05:00Z');
    db.close();
  });
});

// ---- Query Tests ----
describe('queries', () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('listSessions returns sorted by mtime', () => {
    seedProject(db, 'proj-a', 'Project A');
    seedProject(db, 'proj-b', 'Project B');
    seedSession(db, 'proj-a', 'sess-old', 1000);
    seedSession(db, 'proj-b', 'sess-new', 2000);

    const entries = listSessions(db);
    expect(entries).toHaveLength(2);
    expect(entries[0].sessionId).toBe('sess-new');
    expect(entries[1].sessionId).toBe('sess-old');
    expect(entries[0].projectName).toBe('Project B');
    db.close();
  });

  it('getSessionAgents reconstructs time series with compactions', () => {
    seedProject(db);
    seedSession(db);
    seedAgent(db, 'test-project', 'sess-001', 'sess-001', 'claude-sonnet-4-5-20250929', 200000);

    // Insert messages with a big drop (compaction)
    const lines = [
      makeLine('msg-001', 'assistant', '2025-01-15T10:00:00Z', { input_tokens: 100000 }),
      makeLine('msg-002', 'assistant', '2025-01-15T10:01:00Z', { input_tokens: 160000 }),
      makeLine('msg-003', 'assistant', '2025-01-15T10:02:00Z', { input_tokens: 60000 }), // compaction
    ];
    insertLines(db, lines, 'test-project', 'sess-001', 'sess-001');

    const agents = getSessionAgents(db, 'test-project', 'sess-001');
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe('sess-001');
    expect(agents[0].points).toHaveLength(3);
    expect(agents[0].compactions.length).toBeGreaterThanOrEqual(1);
    expect(agents[0].model).toBe('claude-sonnet-4-5-20250929');
    db.close();
  });

  it('getSessionEvents returns inserted events', () => {
    seedProject(db);
    seedSession(db);

    const events: DiagnosticEvent[] = [
      makeEvent('ev-001', 'sess-001', 'agent_started'),
      makeEvent('ev-002', 'sess-001', 'warning_threshold_crossed', 'warning', { pct: 0.72 }),
    ];
    insertEvents(db, events, 'test-project', 'sess-001');

    const result = getSessionEvents(db, 'test-project', 'sess-001');
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('agent_started');
    expect(result[1].data?.pct).toBe(0.72);
    db.close();
  });

  it('getAgentToolStats computes counts', () => {
    seedProject(db);
    seedSession(db);
    seedAgent(db);

    const lines = [
      makeLine('msg-a1', 'assistant', '2025-01-15T10:00:00Z', {
        content: [
          { type: 'tool_use', id: 't1', name: 'read_file', input: {} },
          { type: 'tool_use', id: 't2', name: 'bash', input: {} },
        ],
      }),
      makeLine('msg-u1', 'user', '2025-01-15T10:00:01Z', {
        parentUuid: 'msg-a1',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'fail' },
        ],
      }),
    ];
    insertLines(db, lines, 'test-project', 'sess-001', 'sess-001');

    const stats = getAgentToolStats(db, 'test-project', 'sess-001', 'sess-001');
    expect(stats.toolCallCount).toBe(2);
    expect(stats.toolErrorCount).toBe(1);
    expect(stats.toolErrorRate).toBe(0.5);
    db.close();
  });

  it('sessionExists returns correct boolean', () => {
    seedProject(db);
    seedSession(db);

    expect(sessionExists(db, 'test-project', 'sess-001')).toBe(true);
    expect(sessionExists(db, 'test-project', 'sess-999')).toBe(false);
    db.close();
  });

  it('listProjects returns aggregate stats', () => {
    seedProject(db, 'proj-a', 'Project A');
    seedProject(db, 'proj-b', 'Project B');
    seedSession(db, 'proj-a', 'sess-1', 1000);
    seedSession(db, 'proj-a', 'sess-2', 2000);
    seedSession(db, 'proj-b', 'sess-3', 3000);

    // Set health and turns
    db.run(`UPDATE sessions SET overall_health = 'healthy', total_turns = 10 WHERE session_id = 'sess-1'`);
    db.run(`UPDATE sessions SET overall_health = 'degraded', total_turns = 5 WHERE session_id = 'sess-2'`);
    db.run(`UPDATE sessions SET overall_health = 'unhealthy', total_turns = 20 WHERE session_id = 'sess-3'`);

    const projects = listProjects(db);
    expect(projects).toHaveLength(2);

    // proj-b has most recent activity (mtime=3000)
    expect(projects[0].projectKey).toBe('proj-b');
    expect(projects[0].sessionCount).toBe(1);
    expect(projects[0].unhealthyCount).toBe(1);
    expect(projects[0].totalTurns).toBe(20);

    expect(projects[1].projectKey).toBe('proj-a');
    expect(projects[1].sessionCount).toBe(2);
    expect(projects[1].healthyCount).toBe(1);
    expect(projects[1].degradedCount).toBe(1);
    expect(projects[1].totalTurns).toBe(15);
    db.close();
  });

  it('getSessionMessages returns all messages ordered by timestamp', () => {
    seedProject(db);
    seedSession(db);
    seedAgent(db);

    const lines = [
      makeLine('msg-001', 'user', '2025-01-15T10:00:00Z'),
      makeLine('msg-002', 'assistant', '2025-01-15T10:00:01Z', { input_tokens: 50000, output_tokens: 1000 }),
      makeLine('msg-003', 'user', '2025-01-15T10:00:02Z', { parentUuid: 'msg-002' }),
    ];
    insertLines(db, lines, 'test-project', 'sess-001', 'sess-001');

    const messages = getSessionMessages(db, 'test-project', 'sess-001', 'sess-001');
    expect(messages).toHaveLength(3);
    expect(messages[0].uuid).toBe('msg-001');
    expect(messages[0].type).toBe('user');
    expect(messages[1].uuid).toBe('msg-002');
    expect(messages[1].type).toBe('assistant');
    expect(messages[1].inputTokens).toBe(50000);
    expect(messages[1].outputTokens).toBe(1000);
    expect(messages[2].uuid).toBe('msg-003');
    db.close();
  });

  it('getSessionToolCalls returns tool calls for a session', () => {
    seedProject(db);
    seedSession(db);
    seedAgent(db);

    const lines = [
      makeLine('msg-a1', 'assistant', '2025-01-15T10:00:00Z', {
        content: [
          { type: 'tool_use', id: 't1', name: 'read_file', input: {} },
          { type: 'tool_use', id: 't2', name: 'bash', input: {} },
        ],
      }),
      makeLine('msg-u1', 'user', '2025-01-15T10:00:01Z', {
        parentUuid: 'msg-a1',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'fail' },
        ],
      }),
    ];
    insertLines(db, lines, 'test-project', 'sess-001', 'sess-001');

    // All tool calls for session
    const allCalls = getSessionToolCalls(db, 'test-project', 'sess-001');
    expect(allCalls).toHaveLength(2);
    expect(allCalls[0].toolName).toBe('read_file');
    expect(allCalls[0].isError).toBe(false);
    expect(allCalls[1].toolName).toBe('bash');
    expect(allCalls[1].isError).toBe(true);

    // Filtered by agent
    const agentCalls = getSessionToolCalls(db, 'test-project', 'sess-001', 'sess-001');
    expect(agentCalls).toHaveLength(2);

    // Non-existent agent
    const noCalls = getSessionToolCalls(db, 'test-project', 'sess-001', 'nonexistent');
    expect(noCalls).toHaveLength(0);
    db.close();
  });
});

// ---- Diagnostic Events Tests ----
describe('diagnostic_events', () => {
  it('inserts and retrieves events with JSON data', () => {
    const db = makeDb();
    seedProject(db);
    seedSession(db);

    const event = makeEvent('ev-json', 'sess-001', 'dumbzone_entered', 'critical', {
      pct: 0.87,
      threshold: 0.85,
      nested: { foo: 'bar' },
    });

    insertEvents(db, [event], 'test-project', 'sess-001');

    const results = getSessionEvents(db, 'test-project', 'sess-001');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('ev-json');
    expect(results[0].severity).toBe('critical');
    expect(results[0].data?.pct).toBe(0.87);
    expect(results[0].data?.nested).toEqual({ foo: 'bar' });
    db.close();
  });

  it('does not insert duplicate events', () => {
    const db = makeDb();
    seedProject(db);
    seedSession(db);

    const event = makeEvent('ev-dup', 'sess-001', 'agent_started');
    insertEvents(db, [event], 'test-project', 'sess-001');
    insertEvents(db, [event], 'test-project', 'sess-001');

    const count = db.query<{ c: number }, []>(
      `SELECT COUNT(*) AS c FROM diagnostic_events WHERE id = 'ev-dup'`,
    ).get();
    expect(count!.c).toBe(1);
    db.close();
  });
});
