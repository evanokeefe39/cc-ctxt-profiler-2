import { describe, it, expect } from 'bun:test';
import { buildDagLayout, extractSpawnEdges } from '../dag-layout.js';
import { renderDagSvg } from '../dag-renderer.js';
import type { AgentTimeSeries } from '../../schemas/index.js';
import type { HealthGrade } from '../../schemas/summary.js';

function makeAgent(
  agentId: string,
  model: string,
  startMin: number,
  endMin: number,
  pcts: number[],
): AgentTimeSeries {
  const points = pcts.map((pct, i) => {
    const min = startMin + ((endMin - startMin) * i) / Math.max(pcts.length - 1, 1);
    return {
      t: `2025-01-15T10:${String(Math.floor(min)).padStart(2, '0')}:00Z`,
      abs: pct * 200000,
      pct,
    };
  });
  return {
    agentId,
    model,
    label: agentId,
    limit: 200000,
    threshold: 0.85,
    warningThreshold: 0.7,
    points,
    compactions: [],
  };
}

describe('buildDagLayout', () => {
  it('single agent — 1 node, y=0, no children', () => {
    const agents = [makeAgent('session-1', 'sonnet', 0, 5, [0.1, 0.3, 0.5])];
    const layout = buildDagLayout(agents, 'session-1');
    expect(layout.nodes.size).toBe(1);
    expect(layout.rootId).toBe('session-1');
    const root = layout.nodes.get('session-1')!;
    expect(root.y).toBe(0);
    expect(root.children).toHaveLength(0);
    expect(layout.totalLanes).toBe(1);
  });

  it('multi-agent — root y=0, children sorted by start time', () => {
    const agents = [
      makeAgent('session-1', 'sonnet', 0, 10, [0.1, 0.3]),
      makeAgent('child-b', 'haiku', 5, 10, [0.2, 0.4]),
      makeAgent('child-a', 'haiku', 2, 8, [0.1, 0.2]),
    ];
    const layout = buildDagLayout(agents, 'session-1');
    expect(layout.rootId).toBe('session-1');
    expect(layout.nodes.get('session-1')!.y).toBe(0);
    // child-a starts at min=2, child-b at min=5, so child-a is y=1
    expect(layout.nodes.get('child-a')!.y).toBe(1);
    expect(layout.nodes.get('child-b')!.y).toBe(2);
    expect(layout.totalLanes).toBe(3);
  });

  it('root identification by sessionId match', () => {
    const agents = [
      makeAgent('agent-a', 'sonnet', 0, 5, [0.1]),
      makeAgent('my-session', 'sonnet', 2, 8, [0.2, 0.3]),
    ];
    const layout = buildDagLayout(agents, 'my-session');
    expect(layout.rootId).toBe('my-session');
    expect(layout.nodes.get('my-session')!.y).toBe(0);
    expect(layout.nodes.get('agent-a')!.y).toBe(1);
  });

  it('root fallback when no sessionId match (earliest start)', () => {
    const agents = [
      makeAgent('agent-b', 'sonnet', 5, 10, [0.2]),
      makeAgent('agent-a', 'sonnet', 0, 8, [0.1, 0.3]),
    ];
    const layout = buildDagLayout(agents, 'no-match');
    expect(layout.rootId).toBe('agent-a');
    expect(layout.nodes.get('agent-a')!.y).toBe(0);
  });

  it('time range spans all agents', () => {
    const agents = [
      makeAgent('session-1', 'sonnet', 0, 5, [0.1, 0.2]),
      makeAgent('child-1', 'haiku', 3, 15, [0.1, 0.3, 0.5]),
    ];
    const layout = buildDagLayout(agents, 'session-1');
    // timeMinMs should be from session-1 start (min=0), timeMaxMs from child-1 end (min=15)
    expect(layout.timeMinMs).toBeLessThanOrEqual(layout.timeMaxMs);
    const rootStart = layout.nodes.get('session-1')!.startMs;
    const childEnd = layout.nodes.get('child-1')!.endMs;
    expect(layout.timeMinMs).toBe(rootStart);
    expect(layout.timeMaxMs).toBe(childEnd);
  });

  it('empty points handling', () => {
    const noPoints: AgentTimeSeries = {
      agentId: 'empty-agent',
      model: 'haiku',
      label: 'empty-agent',
      limit: 200000,
      threshold: 0.85,
      warningThreshold: 0.7,
      points: [],
      compactions: [],
    };
    const agents = [makeAgent('session-1', 'sonnet', 0, 5, [0.1, 0.3]), noPoints];
    const layout = buildDagLayout(agents, 'session-1');
    const emptyNode = layout.nodes.get('empty-agent')!;
    expect(emptyNode.startMs).toBe(0);
    expect(emptyNode.endMs).toBe(0);
    expect(emptyNode.totalTurns).toBe(0);
  });

  it('health map integration', () => {
    const agents = [
      makeAgent('session-1', 'sonnet', 0, 5, [0.1]),
      makeAgent('child-1', 'haiku', 2, 8, [0.5, 0.9]),
    ];
    const healthMap = new Map<string, HealthGrade>([
      ['session-1', 'healthy'],
      ['child-1', 'unhealthy'],
    ]);
    const layout = buildDagLayout(agents, 'session-1', healthMap);
    expect(layout.nodes.get('session-1')!.health).toBe('healthy');
    expect(layout.nodes.get('child-1')!.health).toBe('unhealthy');
  });
});

describe('extractSpawnEdges', () => {
  it('single agent → no edges', () => {
    const agents = [makeAgent('session-1', 'sonnet', 0, 5, [0.1])];
    const layout = buildDagLayout(agents, 'session-1');
    const edges = extractSpawnEdges(layout);
    expect(edges).toHaveLength(0);
  });

  it('multi-agent → correct edge count and spawn times', () => {
    const agents = [
      makeAgent('session-1', 'sonnet', 0, 10, [0.1, 0.3]),
      makeAgent('child-1', 'haiku', 3, 8, [0.2, 0.4]),
      makeAgent('child-2', 'haiku', 5, 10, [0.1]),
    ];
    const layout = buildDagLayout(agents, 'session-1');
    const edges = extractSpawnEdges(layout);
    expect(edges).toHaveLength(2);
    // Each edge from root to a child
    expect(edges.every((e) => e.parentId === 'session-1')).toBe(true);
    // Spawn time matches child start
    const child1Edge = edges.find((e) => e.childId === 'child-1')!;
    expect(child1Edge.spawnMs).toBe(layout.nodes.get('child-1')!.startMs);
  });

  it('edge y positions match node y positions', () => {
    const agents = [
      makeAgent('session-1', 'sonnet', 0, 10, [0.1]),
      makeAgent('child-1', 'haiku', 3, 8, [0.2]),
    ];
    const layout = buildDagLayout(agents, 'session-1');
    const edges = extractSpawnEdges(layout);
    const edge = edges[0];
    expect(edge.parentY).toBe(layout.nodes.get('session-1')!.y);
    expect(edge.childY).toBe(layout.nodes.get('child-1')!.y);
  });
});

describe('renderDagSvg', () => {
  it('valid SVG output with <svg tag and title', () => {
    const agents = [
      makeAgent('session-1', 'sonnet', 0, 10, [0.1, 0.3]),
      makeAgent('child-1', 'haiku', 3, 8, [0.2, 0.4]),
    ];
    const layout = buildDagLayout(agents, 'session-1');
    const edges = extractSpawnEdges(layout);
    const svg = renderDagSvg(layout, edges);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Agent Timeline');
  });

  it('single-agent shows "single agent" message', () => {
    const agents = [makeAgent('session-1', 'sonnet', 0, 5, [0.1])];
    const layout = buildDagLayout(agents, 'session-1');
    const edges = extractSpawnEdges(layout);
    const svg = renderDagSvg(layout, edges);
    expect(svg).toContain('Single agent session');
  });

  it('multi-agent shows agent labels and health colors', () => {
    const healthMap = new Map<string, HealthGrade>([
      ['session-1', 'healthy'],
      ['child-1', 'unhealthy'],
    ]);
    const agents = [
      makeAgent('session-1', 'sonnet', 0, 10, [0.1, 0.3]),
      makeAgent('child-1', 'haiku', 3, 8, [0.2, 0.4]),
    ];
    const layout = buildDagLayout(agents, 'session-1', healthMap);
    const edges = extractSpawnEdges(layout);
    const svg = renderDagSvg(layout, edges);
    expect(svg).toContain('session-1');
    expect(svg).toContain('child-1');
    // Healthy green
    expect(svg).toContain('#22c55e');
    // Unhealthy red
    expect(svg).toContain('#ef4444');
  });

  it('spawn connectors have stroke-dasharray', () => {
    const agents = [
      makeAgent('session-1', 'sonnet', 0, 10, [0.1, 0.3]),
      makeAgent('child-1', 'haiku', 3, 8, [0.2, 0.4]),
    ];
    const layout = buildDagLayout(agents, 'session-1');
    const edges = extractSpawnEdges(layout);
    const svg = renderDagSvg(layout, edges);
    expect(svg).toContain('stroke-dasharray="4,3"');
  });
});
