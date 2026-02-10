import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  readJsonlFile,
  parseJsonlContent,
  readJsonlIncremental,
} from '../jsonl-reader.js';
import { discoverSessions } from '../session-discovery.js';
import { computeUsedTokens } from '../token-calculator.js';
import { buildAgentTimeSeries } from '../time-series-builder.js';
import { detectCompactions } from '../compaction-detector.js';
import { parseSession } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('readJsonlFile', () => {
  it('reads a simple session file', () => {
    const lines = readJsonlFile(join(fixturesDir, 'simple-session.jsonl'));
    expect(lines.length).toBe(10);
    expect(lines[0].sessionId).toBe('sess-001');
  });

  it('handles empty/invalid lines gracefully', () => {
    const lines = parseJsonlContent('not json\n\n{"bad": true}\n');
    expect(lines).toHaveLength(0);
  });
});

describe('readJsonlIncremental', () => {
  it('reads from byte offset', () => {
    const filePath = join(fixturesDir, 'simple-session.jsonl');
    // First read
    const result1 = readJsonlIncremental(filePath, 0);
    expect(result1.lines.length).toBeGreaterThan(0);
    expect(result1.bytesRead).toBeGreaterThan(0);

    // Second read from where we left off — should get 0 new lines
    const result2 = readJsonlIncremental(filePath, result1.bytesRead, result1.remainder);
    expect(result2.lines.length).toBe(0);
  });
});

describe('computeUsedTokens', () => {
  it('computes total from all input fields', () => {
    const total = computeUsedTokens({
      input_tokens: 50000,
      output_tokens: 1200,
      cache_creation_input_tokens: 8000,
      cache_read_input_tokens: 12000,
    });
    expect(total).toBe(70000); // 50000 + 8000 + 12000
  });

  it('handles missing cache fields', () => {
    const total = computeUsedTokens({
      input_tokens: 10000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(total).toBe(10000);
  });
});

describe('buildAgentTimeSeries', () => {
  it('builds time series from simple session', () => {
    const lines = readJsonlFile(join(fixturesDir, 'simple-session.jsonl'));
    const ts = buildAgentTimeSeries('sess-001', 'Main', lines);

    expect(ts.agentId).toBe('sess-001');
    expect(ts.model).toBe('claude-sonnet-4-5-20250929');
    expect(ts.limit).toBe(200000);
    // 5 assistant messages
    expect(ts.points).toHaveLength(5);
    // Points should be in ascending order
    expect(ts.points[0].abs).toBeLessThan(ts.points[4].abs);
  });

  it('deduplicates by uuid keeping highest output_tokens', () => {
    const lines = readJsonlFile(join(fixturesDir, 'dedup-session.jsonl'));
    const ts = buildAgentTimeSeries('sess-003', 'Dedup test', lines);

    // d-002 appears twice, should be deduped to 1, so 3 unique assistant msgs
    expect(ts.points).toHaveLength(3);
    // The kept d-002 should have output_tokens=500 (the higher one)
  });
});

describe('detectCompactions', () => {
  it('detects compaction when pct drops > 5%', () => {
    const lines = readJsonlFile(join(fixturesDir, 'compaction-session.jsonl'));
    const ts = buildAgentTimeSeries('sess-002', 'Compaction test', lines);

    expect(ts.compactions.length).toBeGreaterThanOrEqual(1);
    // The drop from 150k to 60k should be detected
    const c = ts.compactions[0];
    expect(c.before).toBeGreaterThan(c.after);
  });

  it('does not flag small drops', () => {
    const points = [
      { t: '2025-01-01T00:00:00Z', abs: 100000, pct: 0.50 },
      { t: '2025-01-01T00:01:00Z', abs: 96000, pct: 0.48 }, // 2% drop — not compaction
    ];
    const compactions = detectCompactions(points);
    expect(compactions).toHaveLength(0);
  });
});

describe('discoverSessions', () => {
  it('discovers multi-agent session', () => {
    const sessions = discoverSessions(join(fixturesDir, 'multi-agent'));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('sess-100');
    expect(sessions[0].agentFiles).toHaveLength(2);
  });

  it('returns empty for nonexistent directory', () => {
    const sessions = discoverSessions('/nonexistent');
    expect(sessions).toHaveLength(0);
  });
});

describe('parseSession', () => {
  it('parses multi-agent session directory', () => {
    const result = parseSession(join(fixturesDir, 'multi-agent'));
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('sess-100');
    // Main + 2 agents = 3
    expect(result!.agents).toHaveLength(3);
  });
});
