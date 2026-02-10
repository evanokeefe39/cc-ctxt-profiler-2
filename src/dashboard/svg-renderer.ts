import type { AgentTimeSeries, DiagnosticEvent } from '../schemas/index.js';

const CHART_WIDTH = 800;
const CHART_HEIGHT = 300;
const PADDING = { left: 60, right: 40, top: 50, bottom: 60 };
const PLOT_LEFT = PADDING.left;
const PLOT_RIGHT = CHART_WIDTH - PADDING.right;
const PLOT_TOP = PADDING.top;
const PLOT_BOTTOM = CHART_HEIGHT - PADDING.bottom;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;

/**
 * Render a self-contained SVG chart for a single agent.
 * Optionally overlays diagnostic event markers with hover tooltips.
 */
export function renderAgentSvg(ts: AgentTimeSeries, events: DiagnosticEvent[] = []): string {
  const { points, compactions, warningThreshold, threshold, agentId, model } = ts;

  if (points.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
      <rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#0a0a0b" rx="8"/>
      <text x="${CHART_WIDTH / 2}" y="${CHART_HEIGHT / 2}" text-anchor="middle" fill="#a1a1aa" font-family="system-ui" font-size="14">No data for ${escapeXml(agentId)}</text>
    </svg>`;
  }

  const peakPct = Math.max(...points.map((p) => p.pct));
  const finalPct = points[points.length - 1].pct;
  const dzTurns = points.filter((p) => p.pct >= threshold).length;
  const totalTurns = points.length;

  // Scale functions
  const xScale = (i: number) => PLOT_LEFT + (i / Math.max(points.length - 1, 1)) * PLOT_WIDTH;
  const yScale = (pct: number) => PLOT_BOTTOM - Math.min(pct, 1.0) * PLOT_HEIGHT;

  // Build step-function path
  let pathD = `M ${xScale(0)} ${yScale(points[0].pct)}`;
  for (let i = 1; i < points.length; i++) {
    const x = xScale(i);
    const prevY = yScale(points[i - 1].pct);
    const currY = yScale(points[i].pct);
    pathD += ` H ${x} V ${currY}`;
  }

  // Warning zone band (yellow)
  const warnY = yScale(threshold);
  const warnBandTop = yScale(threshold);
  const warnBandBottom = yScale(warningThreshold);

  // Dumb zone band (red) — from threshold to top
  const dzBandTop = yScale(1.0);
  const dzBandBottom = yScale(threshold);

  // Grid lines
  const gridLines = [0.25, 0.50, 0.75, 1.0];
  const gridSvg = gridLines
    .map(
      (g) =>
        `<line x1="${PLOT_LEFT}" y1="${yScale(g)}" x2="${PLOT_RIGHT}" y2="${yScale(g)}" stroke="#27272a" stroke-width="1" stroke-dasharray="4,4"/>
         <text x="${PLOT_LEFT - 8}" y="${yScale(g) + 4}" text-anchor="end" fill="#71717a" font-family="system-ui" font-size="11">${(g * 100).toFixed(0)}%</text>`,
    )
    .join('\n');

  // Compaction lines
  const compactionSvg = compactions
    .map((c) => {
      // Find the point index closest to compaction time
      const idx = points.findIndex((p) => p.t >= c.t);
      if (idx < 0) return '';
      const x = xScale(idx);
      return `<line x1="${x}" y1="${PLOT_TOP}" x2="${x}" y2="${PLOT_BOTTOM}" stroke="#22c55e" stroke-width="1.5" stroke-dasharray="6,3"/>`;
    })
    .join('\n');

  // Stats footer
  const stats = [
    `Current: ${(finalPct * 100).toFixed(1)}%`,
    `Peak: ${(peakPct * 100).toFixed(1)}%`,
    `Turns: ${totalTurns}`,
    `DZ turns: ${dzTurns}`,
    `Compactions: ${compactions.length}`,
  ];
  const statsSpacing = PLOT_WIDTH / stats.length;
  const statsSvg = stats
    .map(
      (s, i) =>
        `<text x="${PLOT_LEFT + statsSpacing * i + statsSpacing / 2}" y="${CHART_HEIGHT - 12}" text-anchor="middle" fill="#a1a1aa" font-family="system-ui" font-size="11">${s}</text>`,
    )
    .join('\n');

  // Health color for the line
  let lineColor = '#3b82f6'; // blue = healthy
  if (finalPct >= threshold) lineColor = '#ef4444'; // red = dumb zone
  else if (finalPct >= warningThreshold) lineColor = '#f59e0b'; // amber = warning

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
  <defs>
    <linearGradient id="fill-${escapeAttr(agentId)}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${lineColor}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#09090b" rx="8"/>

  <!-- Title -->
  <text x="${PLOT_LEFT}" y="28" fill="#fafafa" font-family="system-ui" font-size="14" font-weight="600">${escapeXml(agentId)}</text>
  <text x="${PLOT_LEFT}" y="42" fill="#71717a" font-family="system-ui" font-size="11">${escapeXml(model)}</text>

  <!-- Warning zone band -->
  <rect x="${PLOT_LEFT}" y="${warnBandTop}" width="${PLOT_WIDTH}" height="${warnBandBottom - warnBandTop}" fill="#f59e0b" opacity="0.08"/>

  <!-- Dumb zone band -->
  <rect x="${PLOT_LEFT}" y="${dzBandTop}" width="${PLOT_WIDTH}" height="${dzBandBottom - dzBandTop}" fill="#ef4444" opacity="0.1"/>

  <!-- Grid -->
  ${gridSvg}

  <!-- Plot area border -->
  <rect x="${PLOT_LEFT}" y="${PLOT_TOP}" width="${PLOT_WIDTH}" height="${PLOT_HEIGHT}" fill="none" stroke="#27272a" stroke-width="1"/>

  <!-- Warning threshold line -->
  <line x1="${PLOT_LEFT}" y1="${yScale(warningThreshold)}" x2="${PLOT_RIGHT}" y2="${yScale(warningThreshold)}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="8,4" opacity="0.6"/>
  <text x="${PLOT_RIGHT + 4}" y="${yScale(warningThreshold) + 4}" fill="#f59e0b" font-family="system-ui" font-size="10" opacity="0.8">warn</text>

  <!-- Dumb zone threshold line -->
  <line x1="${PLOT_LEFT}" y1="${yScale(threshold)}" x2="${PLOT_RIGHT}" y2="${yScale(threshold)}" stroke="#ef4444" stroke-width="1" stroke-dasharray="8,4" opacity="0.6"/>
  <text x="${PLOT_RIGHT + 4}" y="${yScale(threshold) + 4}" fill="#ef4444" font-family="system-ui" font-size="10" opacity="0.8">dz</text>

  <!-- Compaction lines -->
  ${compactionSvg}

  <!-- Area fill -->
  <path d="${pathD} V ${PLOT_BOTTOM} H ${xScale(0)} Z" fill="url(#fill-${escapeAttr(agentId)})"/>

  <!-- Data line -->
  <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2"/>

  <!-- Data points -->
  ${points.map((p, i) => `<circle cx="${xScale(i)}" cy="${yScale(p.pct)}" r="3" fill="${lineColor}" stroke="#09090b" stroke-width="1.5"/>`).join('\n  ')}

  <!-- Event markers -->
  ${renderEventMarkers(points, events, xScale, yScale)}

  <!-- Stats footer -->
  <line x1="${PLOT_LEFT}" y1="${PLOT_BOTTOM + 20}" x2="${PLOT_RIGHT}" y2="${PLOT_BOTTOM + 20}" stroke="#27272a" stroke-width="1"/>
  ${statsSvg}
</svg>`;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#ef4444',
};

const MARKER_SHAPES: Record<string, string> = {
  info: 'circle',
  warning: 'diamond',
  critical: 'triangle',
};

function renderEventMarkers(
  points: Array<{ t: string; pct: number }>,
  events: DiagnosticEvent[],
  xScale: (i: number) => number,
  yScale: (pct: number) => number,
): string {
  // Skip agent_started/agent_completed — they're not chart-worthy
  const chartEvents = events.filter(
    (e) => e.type !== 'agent_started' && e.type !== 'agent_completed',
  );
  if (chartEvents.length === 0 || points.length === 0) return '';

  return chartEvents
    .map((evt) => {
      // Find the closest point by timestamp
      const evtTime = new Date(evt.timestamp).getTime();
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < points.length; i++) {
        const diff = Math.abs(new Date(points[i].t).getTime() - evtTime);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }

      const x = xScale(bestIdx);
      const y = yScale(points[bestIdx].pct);
      const color = SEVERITY_COLORS[evt.severity] ?? '#3b82f6';
      const shape = MARKER_SHAPES[evt.severity] ?? 'circle';
      const label = evt.type.replace(/_/g, ' ');
      const tooltip = `${label}: ${escapeXml(evt.message)}`;

      // Marker shape
      let marker: string;
      if (shape === 'triangle') {
        marker = `<polygon points="${x},${y - 8} ${x - 6},${y + 4} ${x + 6},${y + 4}" fill="${color}" stroke="#09090b" stroke-width="1.5"/>`;
      } else if (shape === 'diamond') {
        marker = `<polygon points="${x},${y - 7} ${x + 5},${y} ${x},${y + 7} ${x - 5},${y}" fill="${color}" stroke="#09090b" stroke-width="1.5"/>`;
      } else {
        marker = `<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#09090b" stroke-width="1.5"/>`;
      }

      return `<g class="event-marker" style="cursor:pointer">
      ${marker}
      <title>${tooltip}</title>
    </g>`;
    })
    .join('\n  ');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/[^a-zA-Z0-9-_]/g, '_');
}
