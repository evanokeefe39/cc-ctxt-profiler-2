import type { AgentTimeSeries, DiagnosticEvent } from '../../schemas/index.js';
import type { HealthGrade } from '../../schemas/summary.js';
import { renderAgentSvg } from '../svg-renderer.js';
import { buildDagLayout, extractSpawnEdges } from '../dag-layout.js';
import { renderDagSvg } from '../dag-renderer.js';
import { escapeHtml, escapeAttr } from '../layout.js';

/**
 * Render the agents tab content: DAG card + agent SVG cards.
 */
export function renderAgentsTab(
  agents: AgentTimeSeries[],
  events: DiagnosticEvent[],
  sessionId: string,
): string {
  const dagCard = renderDagCard(agents, events, sessionId);

  const agentCards = agents
    .map((agent) => {
      const agentEvents = events.filter((e) => e.agentId === agent.agentId);
      const svg = renderAgentSvg(agent, agentEvents);
      return renderAgentCard(agent, svg, agentEvents);
    })
    .join('\n');

  // Budget breakdown bar chart when >1 agent
  const budgetChart = agents.length > 1 ? renderBudgetChart(agents) : '';

  return `<div class="space-y-6">
    ${dagCard}
    ${budgetChart}
    ${agentCards}
  </div>`;
}

function renderDagCard(
  agents: AgentTimeSeries[],
  events: DiagnosticEvent[],
  sessionId: string,
): string {
  if (agents.length <= 1) return '';
  const healthMap = new Map<string, HealthGrade>();
  for (const agent of agents) {
    const agentEvents = events.filter((e) => e.agentId === agent.agentId);
    const health: HealthGrade = agentEvents.some((e) => e.type === 'dumbzone_lingering')
      ? 'unhealthy'
      : agentEvents.some((e) => e.type === 'dumbzone_entered')
        ? 'degraded'
        : 'healthy';
    healthMap.set(agent.agentId, health);
  }
  const layout = buildDagLayout(agents, sessionId, healthMap);
  const edges = extractSpawnEdges(layout);
  const dagSvg = renderDagSvg(layout, edges);
  return `<div class="rounded-lg border border-border bg-card overflow-hidden">
    <div class="p-4 pb-2">
      <span class="text-sm font-medium">Agent Timeline (${agents.length} agents)</span>
    </div>
    <div class="px-2 pb-2">${dagSvg}</div>
  </div>`;
}

function renderAgentCard(
  agent: AgentTimeSeries,
  svg: string,
  agentEvents: DiagnosticEvent[],
): string {
  const health = agentEvents.some((e) => e.type === 'dumbzone_lingering')
    ? 'unhealthy'
    : agentEvents.some((e) => e.type === 'dumbzone_entered')
      ? 'degraded'
      : 'healthy';

  return `<div id="agent-${escapeAttr(agent.agentId)}" class="rounded-lg border border-border bg-card overflow-hidden">
    <div class="p-4 pb-2 flex items-center justify-between">
      <div>
        <span class="text-sm font-medium">${escapeHtml(agent.label)}</span>
        <span class="text-xs text-muted-foreground ml-2">${escapeHtml(agent.model)}</span>
      </div>
      <span class="text-xs font-medium health-${health} px-2 py-0.5 rounded-full health-bg-${health}">${health}</span>
    </div>
    <div class="px-2 pb-2">
      ${svg}
    </div>
  </div>`;
}

function renderBudgetChart(agents: AgentTimeSeries[]): string {
  const chartId = 'budget-chart-' + Math.random().toString(36).slice(2, 8);
  const labels = agents.map((a) => a.label);
  const peakData = agents.map((a) => {
    const peak = a.points.length > 0 ? Math.max(...a.points.map((p) => p.pct)) * 100 : 0;
    return Math.round(peak);
  });
  const finalData = agents.map((a) => {
    const final = a.points.length > 0 ? a.points[a.points.length - 1].pct * 100 : 0;
    return Math.round(final);
  });

  return `<div class="rounded-lg border border-border bg-card p-4">
    <h3 class="text-sm font-medium mb-3">Context Budget Breakdown</h3>
    <canvas id="${chartId}" height="120"></canvas>
    <script>
      (function() {
        var el = document.getElementById('${chartId}');
        if (!el || !window.Chart) return;
        new Chart(el, {
          type: 'bar',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [
              { label: 'Peak %', data: ${JSON.stringify(peakData)}, backgroundColor: 'rgba(239,68,68,0.6)', borderRadius: 3 },
              { label: 'Final %', data: ${JSON.stringify(finalData)}, backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 3 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: { beginAtZero: true, max: 100, ticks: { color: '#71717a', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
              x: { ticks: { color: '#71717a', font: { size: 10 } }, grid: { display: false } }
            },
            plugins: {
              legend: { labels: { color: '#a1a1aa', font: { size: 10 } } }
            },
            animation: false
          }
        });
      })();
    </script>
  </div>`;
}
