import type { AgentTimeSeries, DiagnosticEvent, SessionSummary } from '../schemas/index.js';
import { renderAgentSvg } from './svg-renderer.js';

/**
 * Render the full dashboard HTML page.
 * Uses Tailwind CSS via CDN for shadcn-inspired dark theme styling.
 */
export function renderDashboardHtml(
  agents: AgentTimeSeries[],
  events: DiagnosticEvent[],
  summary: SessionSummary | null,
  options: { sseEndpoint?: string; title?: string; backLink?: string } = {},
): string {
  const { sseEndpoint = '/events', title = 'Context Diagnostics', backLink } = options;

  const agentCards = agents
    .map((agent) => {
      const agentEvents = events.filter((e) => e.agentId === agent.agentId);
      const svg = renderAgentSvg(agent, agentEvents);
      return renderAgentCard(agent, svg, agentEvents);
    })
    .join('\n');

  const eventFeed = renderEventFeed(events);
  const summaryPanel = summary ? renderSummaryPanel(summary) : '';

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'hsl(240, 3.7%, 15.9%)',
            background: 'hsl(240, 10%, 3.9%)',
            foreground: 'hsl(0, 0%, 98%)',
            card: 'hsl(240, 10%, 3.9%)',
            'card-foreground': 'hsl(0, 0%, 98%)',
            muted: 'hsl(240, 3.7%, 15.9%)',
            'muted-foreground': 'hsl(240, 5%, 64.9%)',
            accent: 'hsl(240, 3.7%, 15.9%)',
            destructive: 'hsl(0, 62.8%, 30.6%)',
          },
        },
      },
    };
  </script>
  <style>
    body { background: hsl(240, 10%, 3.9%); }
    .severity-info { color: #3b82f6; }
    .severity-warning { color: #f59e0b; }
    .severity-critical { color: #ef4444; }
    .health-healthy { color: #22c55e; }
    .health-degraded { color: #f59e0b; }
    .health-unhealthy { color: #ef4444; }
    .sev-btn.active { background: hsl(240, 3.7%, 25%); color: hsl(0, 0%, 98%); }
    .event-card { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: hsl(240, 3.7%, 25%); border-radius: 3px; }
  </style>
</head>
<body class="text-foreground min-h-screen">
  <!-- Header -->
  <header class="border-b border-border px-6 py-4">
    <div class="flex items-center justify-between max-w-[1600px] mx-auto">
      <div>
        ${backLink ? `<a href="${escapeHtml(backLink)}" class="text-xs text-muted-foreground hover:text-foreground mb-1 inline-block">&larr; Back to sessions</a>` : ''}
        <h1 class="text-xl font-semibold tracking-tight">${escapeHtml(title)}</h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          Session: ${escapeHtml(summary?.sessionId ?? 'live')}
          <span id="connection-status" class="ml-3 text-xs px-2 py-0.5 rounded-full bg-muted">connecting...</span>
        </p>
      </div>
      <div class="flex items-center gap-3">
        ${summary ? `<span class="text-sm font-medium health-${summary.overallHealth}">${summary.overallHealth.toUpperCase()}</span>` : ''}
        <span class="text-xs text-muted-foreground" id="last-update"></span>
      </div>
    </div>
  </header>

  <!-- Main layout -->
  <div class="max-w-[1600px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
    <!-- Left: Agent cards -->
    <div class="space-y-6">
      <div id="agent-cards" class="space-y-6">
        ${agentCards}
      </div>
    </div>

    <!-- Right: Sidebar -->
    <aside class="space-y-6">
      <!-- Summary panel -->
      ${summaryPanel}

      <!-- Event feed -->
      <div class="rounded-lg border border-border bg-card p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold">Event Feed</h2>
          <div class="flex gap-1" id="severity-filters">
            <button class="sev-btn active text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground" data-severity="all">All</button>
            <button class="sev-btn text-[10px] px-2 py-0.5 rounded border border-border severity-info" data-severity="info">Info</button>
            <button class="sev-btn text-[10px] px-2 py-0.5 rounded border border-border severity-warning" data-severity="warning">Warn</button>
            <button class="sev-btn text-[10px] px-2 py-0.5 rounded border border-border severity-critical" data-severity="critical">Crit</button>
          </div>
        </div>
        <div id="event-feed" class="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          ${eventFeed}
        </div>
      </div>
    </aside>
  </div>

  <!-- Severity filter script -->
  <script>
    (function() {
      const feed = document.getElementById('event-feed');
      const filtersEl = document.getElementById('severity-filters');
      if (filtersEl) {
        filtersEl.addEventListener('click', function(e) {
          const btn = e.target.closest('.sev-btn');
          if (!btn) return;
          filtersEl.querySelectorAll('.sev-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var sev = btn.dataset.severity;
          feed.querySelectorAll('.event-card').forEach(function(card) {
            card.style.display = (sev === 'all' || card.dataset.severity === sev) ? '' : 'none';
          });
        });
      }
    })();
  </script>

  <!-- SSE Client -->
  <script>
    (function() {
      const statusEl = document.getElementById('connection-status');
      const lastUpdateEl = document.getElementById('last-update');
      let retryDelay = 1000;

      function connect() {
        const es = new EventSource('${sseEndpoint}');

        es.onopen = () => {
          statusEl.textContent = 'live';
          statusEl.className = 'ml-3 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400';
          retryDelay = 1000;
        };

        es.addEventListener('agent_update', (e) => {
          try {
            const data = JSON.parse(e.data);
            const container = document.getElementById('agent-cards');
            const existing = document.getElementById('agent-' + CSS.escape(data.agentId));
            if (existing) {
              existing.outerHTML = data.html;
            } else {
              container.insertAdjacentHTML('beforeend', data.html);
            }
            lastUpdateEl.textContent = new Date().toLocaleTimeString();
          } catch(err) { console.error('agent_update parse error', err); }
        });

        es.addEventListener('diagnostic_event', (e) => {
          try {
            const data = JSON.parse(e.data);
            const feed = document.getElementById('event-feed');
            feed.insertAdjacentHTML('afterbegin', data.html);
            // Keep max 100 events
            while (feed.children.length > 100) feed.removeChild(feed.lastChild);
          } catch(err) { console.error('diagnostic_event parse error', err); }
        });

        es.addEventListener('session_summary', (e) => {
          try {
            const data = JSON.parse(e.data);
            const panel = document.getElementById('summary-panel');
            if (panel) panel.outerHTML = data.html;
          } catch(err) { console.error('session_summary parse error', err); }
        });

        es.onerror = () => {
          statusEl.textContent = 'disconnected';
          statusEl.className = 'ml-3 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400';
          es.close();
          setTimeout(connect, Math.min(retryDelay, 30000));
          retryDelay *= 2;
        };
      }

      connect();
    })();
  </script>
</body>
</html>`;
}

/**
 * Render a static HTML report (no SSE, no live updates).
 */
export function renderReportHtml(
  agents: AgentTimeSeries[],
  events: DiagnosticEvent[],
  summary: SessionSummary,
  options: { backLink?: string } = {},
): string {
  const { backLink } = options;
  const agentCards = agents
    .map((agent) => {
      const agentEvents = events.filter((e) => e.agentId === agent.agentId);
      const svg = renderAgentSvg(agent, agentEvents);
      return renderAgentCard(agent, svg, agentEvents);
    })
    .join('\n');

  const eventFeed = renderEventFeed(events);
  const summaryPanel = renderSummaryPanel(summary);

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Context Diagnostics Report — ${escapeHtml(summary.sessionId)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'hsl(240, 3.7%, 15.9%)',
            background: 'hsl(240, 10%, 3.9%)',
            foreground: 'hsl(0, 0%, 98%)',
            card: 'hsl(240, 10%, 3.9%)',
            'card-foreground': 'hsl(0, 0%, 98%)',
            muted: 'hsl(240, 3.7%, 15.9%)',
            'muted-foreground': 'hsl(240, 5%, 64.9%)',
          },
        },
      },
    };
  </script>
  <style>
    body { background: hsl(240, 10%, 3.9%); }
    .severity-info { color: #3b82f6; }
    .severity-warning { color: #f59e0b; }
    .severity-critical { color: #ef4444; }
    .health-healthy { color: #22c55e; }
    .health-degraded { color: #f59e0b; }
    .health-unhealthy { color: #ef4444; }
    .sev-btn.active { background: hsl(240, 3.7%, 25%); color: hsl(0, 0%, 98%); }
  </style>
</head>
<body class="text-foreground min-h-screen">
  <header class="border-b border-border px-6 py-4">
    <div class="flex items-center justify-between max-w-[1600px] mx-auto">
      <div>
        ${backLink ? `<a href="${escapeHtml(backLink)}" class="text-xs text-muted-foreground hover:text-foreground mb-1 inline-block">&larr; Back to sessions</a>` : ''}
        <h1 class="text-xl font-semibold tracking-tight">Context Diagnostics Report</h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          Session: ${escapeHtml(summary.sessionId)} |
          ${escapeHtml(summary.startTime)} — ${escapeHtml(summary.endTime)}
        </p>
      </div>
      <span class="text-sm font-medium health-${summary.overallHealth}">${summary.overallHealth.toUpperCase()}</span>
    </div>
  </header>

  <div class="max-w-[1600px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
    <div class="space-y-6">
      ${agentCards}
    </div>
    <aside class="space-y-6">
      ${summaryPanel}
      <div class="rounded-lg border border-border bg-card p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold">Events</h2>
          <div class="flex gap-1" id="severity-filters">
            <button class="sev-btn active text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground" data-severity="all">All</button>
            <button class="sev-btn text-[10px] px-2 py-0.5 rounded border border-border severity-info" data-severity="info">Info</button>
            <button class="sev-btn text-[10px] px-2 py-0.5 rounded border border-border severity-warning" data-severity="warning">Warn</button>
            <button class="sev-btn text-[10px] px-2 py-0.5 rounded border border-border severity-critical" data-severity="critical">Crit</button>
          </div>
        </div>
        <div id="event-feed" class="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          ${eventFeed}
        </div>
      </div>
    </aside>
  </div>
  <script>
    (function() {
      var feed = document.getElementById('event-feed');
      var filtersEl = document.getElementById('severity-filters');
      if (filtersEl) {
        filtersEl.addEventListener('click', function(e) {
          var btn = e.target.closest('.sev-btn');
          if (!btn) return;
          filtersEl.querySelectorAll('.sev-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var sev = btn.dataset.severity;
          feed.querySelectorAll('.event-card').forEach(function(card) {
            card.style.display = (sev === 'all' || card.dataset.severity === sev) ? '' : 'none';
          });
        });
      }
    })();
  </script>
</body>
</html>`;
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
      <span class="text-xs font-medium health-${health} px-2 py-0.5 rounded-full bg-muted">${health}</span>
    </div>
    <div class="px-2 pb-2">
      ${svg}
    </div>
  </div>`;
}

function renderEventFeed(events: DiagnosticEvent[]): string {
  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  return sorted
    .map(
      (e) => `<div class="event-card rounded border border-border bg-muted/30 px-3 py-2 text-xs" data-severity="${e.severity}">
      <div class="flex items-center justify-between mb-0.5">
        <span class="font-medium severity-${e.severity}">${escapeHtml(e.type)}</span>
        <span class="text-muted-foreground">${formatTime(e.timestamp)}</span>
      </div>
      <p class="text-muted-foreground">${escapeHtml(e.message)}</p>
    </div>`,
    )
    .join('\n');
}

function renderSummaryPanel(summary: SessionSummary): string {
  const suggestionsHtml = summary.suggestions
    .map(
      (s) => `<div class="flex gap-2 text-xs">
        <span class="shrink-0 w-5 h-5 rounded flex items-center justify-center bg-muted text-muted-foreground font-medium">P${s.priority}</span>
        <span class="text-muted-foreground">${escapeHtml(s.message)}</span>
      </div>`,
    )
    .join('\n');

  const insightsHtml = summary.insights
    .slice(0, 10)
    .map((i) => `<li class="text-xs text-muted-foreground">${escapeHtml(i.message)}</li>`)
    .join('\n');

  return `<div id="summary-panel" class="rounded-lg border border-border bg-card p-4 space-y-4">
    <h2 class="text-sm font-semibold">Session Summary</h2>
    <div class="grid grid-cols-2 gap-3">
      ${summary.agents
        .map(
          (a) => `<div class="rounded border border-border p-2">
          <p class="text-xs text-muted-foreground">${escapeHtml(a.agentId)}</p>
          <p class="text-lg font-semibold health-${a.health}">${(a.peakPct * 100).toFixed(0)}%</p>
          <p class="text-xs text-muted-foreground">${a.totalTurns} turns</p>
        </div>`,
        )
        .join('\n')}
    </div>

    ${summary.insights.length > 0 ? `<div>
      <h3 class="text-xs font-semibold text-muted-foreground mb-2">Insights</h3>
      <ul class="space-y-1 list-disc list-inside">${insightsHtml}</ul>
    </div>` : ''}

    ${summary.suggestions.length > 0 ? `<div>
      <h3 class="text-xs font-semibold text-muted-foreground mb-2">Suggestions</h3>
      <div class="space-y-2">${suggestionsHtml}</div>
    </div>` : ''}
  </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/[^a-zA-Z0-9-_]/g, '_');
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}
