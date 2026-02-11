import { describe, it, expect } from 'bun:test';
import { renderAgentSvg } from '../svg-renderer.js';
import type { AgentTimeSeries } from '../../schemas/index.js';

function makeTimeSeries(pcts: number[]): AgentTimeSeries {
  return {
    agentId: 'test-agent',
    model: 'claude-sonnet-4-5-20250929',
    label: 'Test Agent',
    limit: 200000,
    threshold: 0.85,
    warningThreshold: 0.70,
    points: pcts.map((pct, i) => ({
      t: `2025-01-15T10:${String(i).padStart(2, '0')}:00Z`,
      abs: pct * 200000,
      pct,
    })),
    compactions: [],
  };
}

describe('renderAgentSvg', () => {
  it('renders valid SVG for normal data', () => {
    const ts = makeTimeSeries([0.1, 0.3, 0.5, 0.7, 0.8]);
    const svg = renderAgentSvg(ts);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('test-agent');
    expect(svg).toContain('claude-sonnet');
  });

  it('renders empty state for no data', () => {
    const ts = makeTimeSeries([]);
    const svg = renderAgentSvg(ts);
    expect(svg).toContain('No data');
  });

  it('includes warning and dumb zone bands', () => {
    const ts = makeTimeSeries([0.1, 0.5, 0.8]);
    const svg = renderAgentSvg(ts);
    // Warning band color (amber)
    expect(svg).toContain('#f59e0b');
    // Dumb zone band color (red)
    expect(svg).toContain('#ef4444');
  });

  it('includes compaction lines', () => {
    const ts: AgentTimeSeries = {
      ...makeTimeSeries([0.5, 0.8, 0.3, 0.5]),
      compactions: [{ t: '2025-01-15T10:02:00Z', before: 160000, after: 60000 }],
    };
    const svg = renderAgentSvg(ts);
    // Compaction line color (green)
    expect(svg).toContain('#22c55e');
  });

  it('includes stats footer', () => {
    const ts = makeTimeSeries([0.1, 0.5, 0.8]);
    const svg = renderAgentSvg(ts);
    expect(svg).toContain('Current:');
    expect(svg).toContain('Peak:');
    expect(svg).toContain('Turns:');
  });

  it('uses correct line color based on status', () => {
    // Final pct in dumb zone → red
    const ts = makeTimeSeries([0.1, 0.5, 0.90]);
    const svg = renderAgentSvg(ts);
    expect(svg).toContain('stroke="#ef4444"');
  });

  it('renders data points as circles', () => {
    const ts = makeTimeSeries([0.1, 0.3, 0.5]);
    const svg = renderAgentSvg(ts);
    // Should have 3 circle elements
    const circles = svg.match(/<circle/g);
    expect(circles).toHaveLength(3);
  });
});
