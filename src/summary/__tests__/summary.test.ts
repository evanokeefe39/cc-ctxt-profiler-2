import { describe, it, expect } from 'vitest';
import { classifyHealth } from '../health-classifier.js';
import { generateInsights } from '../insight-generator.js';
import { generateSuggestions } from '../suggestion-generator.js';
import { buildSessionSummary } from '../index.js';
import type { AgentTimeSeries, DiagnosticEvent } from '../../schemas/index.js';

function makeTimeSeries(
  agentId: string,
  pcts: number[],
  compactions: AgentTimeSeries['compactions'] = [],
): AgentTimeSeries {
  return {
    agentId,
    model: 'claude-sonnet-4-5-20250929',
    label: agentId,
    limit: 200000,
    threshold: 0.85,
    warningThreshold: 0.70,
    points: pcts.map((pct, i) => ({
      t: `2025-01-15T10:${String(i).padStart(2, '0')}:00Z`,
      abs: pct * 200000,
      pct,
    })),
    compactions,
  };
}

function makeEvent(
  agentId: string,
  type: DiagnosticEvent['type'],
  severity: DiagnosticEvent['severity'] = 'info',
  data?: Record<string, unknown>,
): DiagnosticEvent {
  return {
    id: 'test1234',
    timestamp: '2025-01-15T10:00:00Z',
    agentId,
    severity,
    type,
    message: `Test event: ${type}`,
    data,
  };
}

describe('classifyHealth', () => {
  it('returns healthy for low usage', () => {
    const ts = makeTimeSeries('a', [0.1, 0.2, 0.3, 0.4, 0.5]);
    const health = classifyHealth({
      timeSeries: ts,
      events: [],
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
      maxToolErrorRate: 0.15,
      expectedTurns: [5, 20],
    });
    expect(health).toBe('healthy');
  });

  it('returns unhealthy when dumbzone lingering', () => {
    const ts = makeTimeSeries('a', [0.5, 0.87, 0.88, 0.89, 0.90]);
    const events = [makeEvent('a', 'dumbzone_lingering', 'critical')];
    const health = classifyHealth({
      timeSeries: ts,
      events,
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
      maxToolErrorRate: 0.15,
      expectedTurns: [5, 20],
    });
    expect(health).toBe('unhealthy');
  });

  it('returns degraded when >20% warning turns', () => {
    // 3/5 = 60% in warning zone
    const ts = makeTimeSeries('a', [0.1, 0.72, 0.75, 0.78, 0.5]);
    const health = classifyHealth({
      timeSeries: ts,
      events: [],
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
      maxToolErrorRate: 0.15,
      expectedTurns: [5, 20],
    });
    expect(health).toBe('degraded');
  });

  it('returns degraded when entered dz but compacted', () => {
    const ts = makeTimeSeries('a', [0.5, 0.87, 0.4, 0.5]);
    const events = [
      makeEvent('a', 'dumbzone_entered', 'critical'),
      makeEvent('a', 'compaction_detected'),
    ];
    const health = classifyHealth({
      timeSeries: ts,
      events,
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
      maxToolErrorRate: 0.15,
      expectedTurns: [5, 20],
    });
    expect(health).toBe('degraded');
  });

  it('returns unhealthy when >2x expected turns', () => {
    const pcts = Array.from({ length: 42 }, (_, i) => 0.1 + (i * 0.01));
    const ts = makeTimeSeries('a', pcts);
    const health = classifyHealth({
      timeSeries: ts,
      events: [],
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
      maxToolErrorRate: 0.15,
      expectedTurns: [5, 20],
    });
    expect(health).toBe('unhealthy');
  });

  it('returns healthy for empty points', () => {
    const ts = makeTimeSeries('a', []);
    const health = classifyHealth({
      timeSeries: ts,
      events: [],
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
      maxToolErrorRate: 0.15,
      expectedTurns: [5, 20],
    });
    expect(health).toBe('healthy');
  });
});

describe('generateInsights', () => {
  it('generates peak usage insight', () => {
    const ts = makeTimeSeries('a', [0.1, 0.3, 0.5]);
    const insights = generateInsights({
      timeSeries: ts,
      events: [],
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
    });
    expect(insights.some((i) => i.category === 'peak-usage')).toBe(true);
  });

  it('generates dumb zone insight', () => {
    const ts = makeTimeSeries('a', [0.5, 0.87, 0.90]);
    const insights = generateInsights({
      timeSeries: ts,
      events: [],
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
    });
    expect(insights.some((i) => i.category === 'dumb-zone')).toBe(true);
  });

  it('generates compaction insight', () => {
    const ts = makeTimeSeries('a', [0.5, 0.8, 0.3], [
      { t: '2025-01-15T10:02:00Z', before: 160000, after: 60000 },
    ]);
    const insights = generateInsights({
      timeSeries: ts,
      events: [],
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
    });
    expect(insights.some((i) => i.category === 'compaction')).toBe(true);
  });

  it('generates profile insight for unmatched agents', () => {
    const ts = makeTimeSeries('a', [0.1]);
    const events = [makeEvent('a', 'unmatched_agent')];
    const insights = generateInsights({
      timeSeries: ts,
      events,
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
    });
    expect(insights.some((i) => i.category === 'profile')).toBe(true);
  });
});

describe('generateSuggestions', () => {
  it('generates P1 suggestion for unhealthy lingering', () => {
    const ts = makeTimeSeries('a', [0.87, 0.88, 0.89, 0.90]);
    const events = [makeEvent('a', 'dumbzone_lingering', 'critical')];
    const suggestions = generateSuggestions([{
      agentId: 'a',
      health: 'unhealthy',
      timeSeries: ts,
      events,
      dumbZoneThreshold: 0.85,
      warningThreshold: 0.70,
      expectedTurns: [5, 20],
    }]);
    expect(suggestions[0].priority).toBe(1);
  });

  it('generates P3 suggestion for unmatched agent', () => {
    const ts = makeTimeSeries('a', [0.1]);
    const events = [makeEvent('a', 'unmatched_agent')];
    const suggestions = generateSuggestions([{
      agentId: 'a',
      health: 'healthy',
      timeSeries: ts,
      events,
      dumbZoneThreshold: 0.85,
      warningThreshold: 0.70,
      expectedTurns: [5, 20],
    }]);
    expect(suggestions.some((s) => s.priority === 3)).toBe(true);
  });

  it('generates P5 coordination suggestion for multiple unhealthy agents', () => {
    const makeInput = (id: string) => ({
      agentId: id,
      health: 'unhealthy' as const,
      timeSeries: makeTimeSeries(id, [0.9]),
      events: [makeEvent(id, 'dumbzone_lingering', 'critical')],
      dumbZoneThreshold: 0.85,
      warningThreshold: 0.70,
      expectedTurns: [5, 20] as [number, number],
    });
    const suggestions = generateSuggestions([makeInput('a'), makeInput('b')]);
    expect(suggestions.some((s) => s.priority === 5)).toBe(true);
  });

  it('sorts suggestions by priority', () => {
    const ts = makeTimeSeries('a', [0.87, 0.88, 0.89]);
    const events = [
      makeEvent('a', 'dumbzone_lingering', 'critical'),
      makeEvent('a', 'unmatched_agent'),
    ];
    const suggestions = generateSuggestions([{
      agentId: 'a',
      health: 'unhealthy',
      timeSeries: ts,
      events,
      dumbZoneThreshold: 0.85,
      warningThreshold: 0.70,
      expectedTurns: [5, 20],
    }]);
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i].priority).toBeGreaterThanOrEqual(suggestions[i - 1].priority);
    }
  });
});

describe('buildSessionSummary', () => {
  it('builds complete summary for a session', () => {
    const agents = [
      makeTimeSeries('main', [0.1, 0.3, 0.5, 0.7]),
      makeTimeSeries('sub-1', [0.1, 0.2]),
    ];
    const events: DiagnosticEvent[] = [
      makeEvent('main', 'agent_started'),
      makeEvent('sub-1', 'agent_started'),
      makeEvent('sub-1', 'unmatched_agent'),
    ];

    const summary = buildSessionSummary('sess-001', agents, events);
    expect(summary.sessionId).toBe('sess-001');
    expect(summary.agents).toHaveLength(2);
    expect(summary.insights.length).toBeGreaterThan(0);
    expect(summary.overallHealth).toBeDefined();
  });

  it('overall health is worst of all agents', () => {
    const agents = [
      makeTimeSeries('healthy-agent', [0.1, 0.2]),
      makeTimeSeries('sick-agent', [0.87, 0.88, 0.89, 0.90]),
    ];
    const events: DiagnosticEvent[] = [
      makeEvent('sick-agent', 'dumbzone_lingering', 'critical'),
      makeEvent('sick-agent', 'dumbzone_entered', 'critical'),
    ];

    const summary = buildSessionSummary('sess-002', agents, events);
    expect(summary.overallHealth).toBe('unhealthy');
  });
});
