import { describe, it, expect } from 'vitest';
import { EventEvaluator } from '../event-evaluator.js';
import { extractToolStats } from '../tool-extractor.js';
import type { TimeSeriesPoint, TranscriptLine } from '../../schemas/index.js';

function point(pct: number, t: string = '2025-01-15T10:00:00Z'): TimeSeriesPoint {
  return { t, abs: pct * 200000, pct };
}

describe('EventEvaluator', () => {
  it('emits agent_started on first turn', () => {
    const ev = new EventEvaluator({ agentId: 'test', profileId: 'test-profile' });
    const events = ev.evaluateTurn(point(0.1));
    expect(events.some((e) => e.type === 'agent_started')).toBe(true);
  });

  it('emits unmatched_agent when no profileId', () => {
    const ev = new EventEvaluator({ agentId: 'test' });
    const events = ev.evaluateTurn(point(0.1));
    expect(events.some((e) => e.type === 'unmatched_agent')).toBe(true);
  });

  it('does not emit unmatched_agent when profileId set', () => {
    const ev = new EventEvaluator({ agentId: 'test', profileId: 'p1' });
    const events = ev.evaluateTurn(point(0.1));
    expect(events.some((e) => e.type === 'unmatched_agent')).toBe(false);
  });

  it('emits warning_threshold_crossed', () => {
    const ev = new EventEvaluator({
      agentId: 'test',
      profileId: 'p1',
      warningThreshold: 0.70,
    });
    ev.evaluateTurn(point(0.50));
    const events = ev.evaluateTurn(point(0.72));
    expect(events.some((e) => e.type === 'warning_threshold_crossed')).toBe(true);
  });

  it('only emits warning_threshold_crossed once', () => {
    const ev = new EventEvaluator({
      agentId: 'test',
      profileId: 'p1',
      warningThreshold: 0.70,
    });
    ev.evaluateTurn(point(0.50));
    ev.evaluateTurn(point(0.72));
    const events = ev.evaluateTurn(point(0.75));
    expect(events.some((e) => e.type === 'warning_threshold_crossed')).toBe(false);
  });

  it('emits dumbzone_entered', () => {
    const ev = new EventEvaluator({
      agentId: 'test',
      profileId: 'p1',
      dumbZoneThreshold: 0.85,
    });
    ev.evaluateTurn(point(0.50));
    const events = ev.evaluateTurn(point(0.87));
    expect(events.some((e) => e.type === 'dumbzone_entered')).toBe(true);
    expect(events.find((e) => e.type === 'dumbzone_entered')!.severity).toBe('critical');
  });

  it('emits dumbzone_lingering after maxTurnsInDumbZone', () => {
    const ev = new EventEvaluator({
      agentId: 'test',
      profileId: 'p1',
      dumbZoneThreshold: 0.85,
      maxTurnsInDumbZone: 2,
    });
    ev.evaluateTurn(point(0.50));
    ev.evaluateTurn(point(0.87)); // 1st dz turn
    ev.evaluateTurn(point(0.88)); // 2nd dz turn
    const events = ev.evaluateTurn(point(0.89)); // 3rd dz turn — should linger
    expect(events.some((e) => e.type === 'dumbzone_lingering')).toBe(true);
  });

  it('emits compaction_detected on large drop', () => {
    const ev = new EventEvaluator({ agentId: 'test', profileId: 'p1' });
    ev.evaluateTurn(point(0.10));
    ev.evaluateTurn(point(0.80));
    const events = ev.evaluateTurn(point(0.40));
    expect(events.some((e) => e.type === 'compaction_detected')).toBe(true);
  });

  it('compaction resets warning/dumbzone flags', () => {
    const ev = new EventEvaluator({
      agentId: 'test',
      profileId: 'p1',
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
    });
    ev.evaluateTurn(point(0.10));
    ev.evaluateTurn(point(0.72)); // warning crossed
    ev.evaluateTurn(point(0.87)); // dz entered
    ev.evaluateTurn(point(0.30)); // compaction

    // Now crossing warning again should re-emit
    const events = ev.evaluateTurn(point(0.75));
    expect(events.some((e) => e.type === 'warning_threshold_crossed')).toBe(true);
  });

  it('emits compaction_insufficient when still above target', () => {
    const ev = new EventEvaluator({
      agentId: 'test',
      profileId: 'p1',
      compactionTarget: 0.50,
    });
    ev.evaluateTurn(point(0.10));
    ev.evaluateTurn(point(0.80));
    const events = ev.evaluateTurn(point(0.55)); // dropped but still > 0.50
    expect(events.some((e) => e.type === 'compaction_insufficient')).toBe(true);
  });

  it('emits scope_creep when exceeding expectedTurns', () => {
    const ev = new EventEvaluator({
      agentId: 'test',
      profileId: 'p1',
      expectedTurns: [1, 3],
    });
    ev.evaluateTurn(point(0.10));
    ev.evaluateTurn(point(0.20));
    ev.evaluateTurn(point(0.30));
    const events = ev.evaluateTurn(point(0.40)); // turn 4 > max 3
    expect(events.some((e) => e.type === 'scope_creep')).toBe(true);
  });

  it('emits tool_error_spike', () => {
    const ev = new EventEvaluator({
      agentId: 'test',
      profileId: 'p1',
      maxToolErrorRate: 0.15,
    });
    ev.evaluateTurn(point(0.10), 5, 0);
    const events = ev.evaluateTurn(point(0.20), 5, 3); // 3/10 = 30% > 15%
    expect(events.some((e) => e.type === 'tool_error_spike')).toBe(true);
  });

  it('emits agent_completed', () => {
    const ev = new EventEvaluator({ agentId: 'test', profileId: 'p1' });
    ev.evaluateTurn(point(0.50));
    const event = ev.complete('2025-01-15T11:00:00Z');
    expect(event.type).toBe('agent_completed');
    expect(event.data?.totalTurns).toBe(1);
  });

  it('event IDs are unique 8-char strings', () => {
    const ev = new EventEvaluator({ agentId: 'test' });
    const events = ev.evaluateTurn(point(0.10));
    for (const e of events) {
      expect(e.id).toHaveLength(8);
    }
  });
});

describe('extractToolStats', () => {
  it('counts tool_use blocks in assistant message', () => {
    const assistant: TranscriptLine = {
      sessionId: 's',
      uuid: 'u1',
      timestamp: 'now',
      type: 'assistant',
      isSidechain: false,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 't1', name: 'read_file', input: {} },
          { type: 'tool_use', id: 't2', name: 'grep', input: {} },
        ],
      },
    };

    const stats = extractToolStats(assistant);
    expect(stats.toolUseCount).toBe(2);
    expect(stats.toolErrorCount).toBe(0);
  });

  it('counts tool_result errors in user message', () => {
    const assistant: TranscriptLine = {
      sessionId: 's',
      uuid: 'u1',
      timestamp: 'now',
      type: 'assistant',
      isSidechain: false,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }],
      },
    };

    const user: TranscriptLine = {
      sessionId: 's',
      uuid: 'u2',
      timestamp: 'now',
      type: 'user',
      isSidechain: false,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Command failed' },
        ],
      },
    };

    const stats = extractToolStats(assistant, user);
    expect(stats.toolUseCount).toBe(1);
    expect(stats.toolErrorCount).toBe(1);
  });
});
