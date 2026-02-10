import { createServer, type Server } from 'node:http';
import type { AgentTimeSeries, DiagnosticEvent, SessionSummary } from '../schemas/index.js';
import { renderDashboardHtml } from './html-template.js';
import { SseManager } from './sse-manager.js';

export interface DashboardState {
  agents: AgentTimeSeries[];
  events: DiagnosticEvent[];
  summary: SessionSummary | null;
}

export interface DashboardServer {
  server: Server;
  sse: SseManager;
  updateState: (state: Partial<DashboardState>) => void;
  start: (port: number) => Promise<string>;
  stop: () => Promise<void>;
}

/**
 * Create a dashboard HTTP server.
 * Routes: GET / → HTML, GET /events → SSE stream, GET /api/state → JSON snapshot.
 */
export function createDashboardServer(): DashboardServer {
  const sse = new SseManager();
  const state: DashboardState = {
    agents: [],
    events: [],
    summary: null,
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const html = renderDashboardHtml(state.agents, state.events, state.summary);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      sse.addClient(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(state));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  function updateState(update: Partial<DashboardState>): void {
    if (update.agents) state.agents = update.agents;
    if (update.events) state.events = update.events;
    if (update.summary !== undefined) state.summary = update.summary;
  }

  function start(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      server.listen(port, () => {
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(`http://localhost:${actualPort}`);
      });
      server.on('error', reject);
    });
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      sse.close();
      server.close(() => resolve());
    });
  }

  return { server, sse, updateState, start, stop };
}
