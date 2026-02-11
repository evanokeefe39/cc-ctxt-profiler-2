import type { DagLayout, SpawnEdge } from './dag-layout.js';

const DAG_WIDTH = 800;
const PADDING = { left: 120, right: 30, top: 40, bottom: 30 };
const LANE_HEIGHT = 44;
const BAR_HEIGHT = 28;

const HEALTH_COLORS: Record<string, { fill: string; stroke: string }> = {
  healthy: { fill: 'rgba(34,197,94,0.6)', stroke: '#22c55e' },
  degraded: { fill: 'rgba(245,158,11,0.6)', stroke: '#f59e0b' },
  unhealthy: { fill: 'rgba(239,68,68,0.6)', stroke: '#ef4444' },
};

export function renderDagSvg(layout: DagLayout, edges: SpawnEdge[]): string {
  // Single-agent: simple message
  if (layout.totalLanes <= 1) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 60">
  <rect width="800" height="60" fill="#09090b" rx="8"/>
  <text x="400" y="34" text-anchor="middle" fill="#71717a" font-family="system-ui" font-size="12">Single agent session</text>
</svg>`;
  }

  const dagHeight = PADDING.top + layout.totalLanes * LANE_HEIGHT + PADDING.bottom;
  const plotLeft = PADDING.left;
  const plotRight = DAG_WIDTH - PADDING.right;
  const plotWidth = plotRight - plotLeft;
  const timeRange = layout.timeMaxMs - layout.timeMinMs;

  const xScale = (ms: number) => {
    if (timeRange === 0) return plotLeft + plotWidth / 2;
    return plotLeft + ((ms - layout.timeMinMs) / timeRange) * plotWidth;
  };

  const laneY = (lane: number) => PADDING.top + lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2;

  // Time axis ticks (4-5 ticks)
  const tickCount = 5;
  const ticksSvg: string[] = [];
  for (let i = 0; i < tickCount; i++) {
    const ms = layout.timeMinMs + (timeRange * i) / (tickCount - 1);
    const x = xScale(ms);
    const label = formatTimeMs(ms);
    ticksSvg.push(
      `<line x1="${x}" y1="${PADDING.top}" x2="${x}" y2="${dagHeight - PADDING.bottom}" stroke="#27272a" stroke-width="1" stroke-dasharray="4,4"/>`,
      `<text x="${x}" y="${dagHeight - 10}" text-anchor="middle" fill="#71717a" font-family="system-ui" font-size="9">${escapeXml(label)}</text>`,
    );
  }

  // Agent bars
  const barsSvg: string[] = [];
  for (const node of layout.nodes.values()) {
    const y = laneY(node.y);
    const colors = HEALTH_COLORS[node.health] ?? HEALTH_COLORS.healthy;

    // Label (left of bar)
    barsSvg.push(
      `<text x="${plotLeft - 6}" y="${y + 12}" text-anchor="end" fill="#fafafa" font-family="system-ui" font-size="11">${escapeXml(node.label)}</text>`,
      `<text x="${plotLeft - 6}" y="${y + 23}" text-anchor="end" fill="#71717a" font-family="system-ui" font-size="9">${escapeXml(node.model)}</text>`,
    );

    // Bar
    if (node.totalTurns > 0) {
      let barX = xScale(node.startMs);
      let barW = xScale(node.endMs) - barX;
      if (barW < 4) barW = 4; // min width
      barsSvg.push(
        `<rect x="${barX}" y="${y}" width="${barW}" height="${BAR_HEIGHT}" rx="4" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>`,
      );
      // Stats inside bar
      const stats = `${node.totalTurns} turns | peak ${(node.peakPct * 100).toFixed(0)}%`;
      if (barW > 60) {
        barsSvg.push(
          `<text x="${barX + barW / 2}" y="${y + 17}" text-anchor="middle" fill="#d4d4d8" font-family="system-ui" font-size="9">${escapeXml(stats)}</text>`,
        );
      }
    } else {
      // No data: thin placeholder
      barsSvg.push(
        `<rect x="${plotLeft}" y="${y}" width="4" height="${BAR_HEIGHT}" rx="2" fill="#27272a" stroke="#3f3f46" stroke-width="1"/>`,
      );
    }
  }

  // Spawn connectors
  const edgesSvg: string[] = [];
  for (const edge of edges) {
    const x = xScale(edge.spawnMs);
    const parentCenterY = laneY(edge.parentY) + BAR_HEIGHT / 2;
    const childCenterY = laneY(edge.childY) + BAR_HEIGHT / 2;
    edgesSvg.push(
      `<line x1="${x}" y1="${parentCenterY}" x2="${x}" y2="${childCenterY}" stroke="#71717a" stroke-width="1" stroke-dasharray="4,3"/>`,
      `<circle cx="${x}" cy="${childCenterY}" r="3" fill="#71717a"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DAG_WIDTH} ${dagHeight}">
  <rect width="${DAG_WIDTH}" height="${dagHeight}" fill="#09090b" rx="8"/>
  <text x="${plotLeft}" y="26" fill="#fafafa" font-family="system-ui" font-size="13" font-weight="600">Agent Timeline</text>
  ${ticksSvg.join('\n  ')}
  ${barsSvg.join('\n  ')}
  ${edgesSvg.join('\n  ')}
</svg>`;
}

function formatTimeMs(ms: number): string {
  if (ms === 0) return '00:00:00';
  const d = new Date(ms);
  return d.toISOString().slice(11, 19);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
