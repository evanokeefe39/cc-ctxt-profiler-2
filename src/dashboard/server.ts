import { Hono } from 'hono';
import type { AgentTimeSeries, DiagnosticEvent, SessionSummary } from '../schemas/index.js';
import { renderLayout, escapeHtml } from './layout.js';
import { renderAgentsTab } from './partials/agents-tab.js';
import { renderEventsTab } from './partials/events-tab.js';
import { SseManager } from './sse-manager.js';

export interface DashboardState {
  agents: AgentTimeSeries[];
  events: DiagnosticEvent[];
  summary: SessionSummary | null;
}

export interface DashboardServer {
  app: Hono;
  sse: SseManager;
  updateState: (state: Partial<DashboardState>) => void;
  start: (port: number) => Promise<string>;
  stop: () => Promise<void>;
}

/**
 * Create a live dashboard HTTP server using Hono + Bun.serve.
 * Routes: GET / → HTML, GET /events → SSE stream, GET /api/state → JSON snapshot.
 */
export function createDashboardServer(): DashboardServer {
  const sse = new SseManager();
  const state: DashboardState = {
    agents: [],
    events: [],
    summary: null,
  };

  const app = new Hono();

  app.get('/', (c) => {
    const sessionId = state.summary?.sessionId ?? 'live';
    const health = state.summary?.overallHealth;

    // Build agent cards + event feed as content
    const agentsContent = renderAgentsTab(state.agents, state.events, sessionId);

    const summaryPanel = state.summary ? renderSummaryPanel(state.summary) : '';
    const eventFeed = renderEventsTab(state.events);

    const content = `<div class="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
      <div class="space-y-6">
        <div id="agent-cards">
          ${agentsContent}
        </div>
      </div>
      <aside class="space-y-6">
        ${summaryPanel}
        <div class="rounded-lg border border-border bg-card p-4">
          <h2 class="text-sm font-semibold mb-3">Event Feed</h2>
          <div id="event-feed">
            ${eventFeed}
          </div>
        </div>
      </aside>
    </div>`;

    const breadcrumb = `<span class="text-foreground">Live Monitor</span>
      ${health ? `<span class="ml-3 text-xs font-medium health-${health}">${health.toUpperCase()}</span>` : ''}`;

    const sseScript = `<script>
    (function() {
      const statusEl = document.getElementById('connection-status');
      const lastUpdateEl = document.getElementById('last-update');
      let retryDelay = 1000;

      function connect() {
        const es = new EventSource('/events');

        es.onopen = () => {
          if (statusEl) {
            statusEl.textContent = 'live';
            statusEl.className = 'text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400';
          }
          retryDelay = 1000;
        };

        es.addEventListener('agent_update', (e) => {
          try {
            const data = JSON.parse(e.data);
            const container = document.getElementById('agent-cards');
            const existing = document.getElementById('agent-' + CSS.escape(data.agentId));
            if (existing) {
              existing.outerHTML = data.html;
            } else if (container) {
              container.insertAdjacentHTML('beforeend', data.html);
            }
          } catch(err) { console.error('agent_update parse error', err); }
        });

        es.addEventListener('diagnostic_event', (e) => {
          try {
            const data = JSON.parse(e.data);
            const feed = document.getElementById('event-feed');
            if (feed) {
              feed.insertAdjacentHTML('afterbegin', data.html);
              while (feed.children.length > 100) feed.removeChild(feed.lastChild);
            }
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
          if (statusEl) {
            statusEl.textContent = 'disconnected';
            statusEl.className = 'text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400';
          }
          es.close();
          setTimeout(connect, Math.min(retryDelay, 30000));
          retryDelay *= 2;
        };
      }

      connect();
    })();
    </script>`;

    const html = renderLayout({
      title: 'Live Monitor — context-diag',
      breadcrumb,
      content,
      scripts: sseScript,
      sseEndpoint: '/events',
    });

    return c.html(html);
  });

  app.get('/events', (c) => {
    const encoder = new TextEncoder();
    let cleanup: (() => void) | undefined;

    const stream = new ReadableStream({
      start(controller) {
        const id = crypto.randomUUID();
        const write = (data: string) => {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            cleanup?.();
          }
        };

        controller.enqueue(encoder.encode(':ok\n\n'));
        cleanup = sse.addClient(id, write, () => {
          try { controller.close(); } catch { /* already closed */ }
        });
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });

  app.get('/api/state', (c) => {
    return c.json(state);
  });

  let bunServer: ReturnType<typeof Bun.serve> | null = null;

  function updateState(update: Partial<DashboardState>): void {
    if (update.agents) state.agents = update.agents;
    if (update.events) state.events = update.events;
    if (update.summary !== undefined) state.summary = update.summary;
  }

  function start(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        bunServer = Bun.serve({
          port,
          fetch: app.fetch,
        });
        resolve(`http://localhost:${bunServer.port}`);
      } catch (err) {
        reject(err);
      }
    });
  }

  function stop(): Promise<void> {
    sse.close();
    bunServer?.stop();
    bunServer = null;
    return Promise.resolve();
  }

  return { app, sse, updateState, start, stop };
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
