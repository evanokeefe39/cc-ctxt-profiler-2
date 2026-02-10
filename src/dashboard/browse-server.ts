import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { discoverAllSessions } from '../parser/session-discovery.js';
import { parseSessionById } from '../parser/index.js';
import { EventEvaluator } from '../engine/event-evaluator.js';
import { getEffectiveThresholds } from '../profiles/matcher.js';
import { buildSessionSummary } from '../summary/index.js';
import { renderReportHtml } from './html-template.js';
import { renderSessionListHtml } from './session-list-template.js';
import type { DiagnosticEvent, ProfilesConfig } from '../schemas/index.js';

export interface BrowseServer {
  server: Server;
  start: (port: number) => Promise<string>;
  stop: () => Promise<void>;
}

export function createBrowseServer(projectsDir: string, profilesConfig?: ProfilesConfig): BrowseServer {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const entries = discoverAllSessions(projectsDir);
      const html = renderSessionListHtml(entries);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const entries = discoverAllSessions(projectsDir);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(entries));
      return;
    }

    // Session detail: /session/:projectKey/:sessionId
    const detailMatch = url.pathname.match(/^\/session\/([^/]+)\/([^/]+)$/);
    if (req.method === 'GET' && detailMatch) {
      const projectKey = decodeURIComponent(detailMatch[1]);
      const sessionId = decodeURIComponent(detailMatch[2]);
      const projectDir = join(projectsDir, projectKey);

      const session = parseSessionById(projectDir, sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Session not found');
        return;
      }

      // Run evaluators
      const allEvents: DiagnosticEvent[] = [];
      for (const agent of session.agents) {
        const thresholds = getEffectiveThresholds(agent.agentId, agent.model, profilesConfig);
        const evaluator = new EventEvaluator({
          agentId: agent.agentId,
          profileId: thresholds.profileId,
          warningThreshold: thresholds.warningThreshold,
          dumbZoneThreshold: thresholds.dumbZoneThreshold,
          compactionTarget: thresholds.compactionTarget,
          maxTurnsInDumbZone: thresholds.maxTurnsInDumbZone,
          maxToolErrorRate: thresholds.maxToolErrorRate,
          expectedTurns: thresholds.expectedTurns,
        });

        for (const point of agent.points) {
          const events = evaluator.evaluateTurn(point);
          allEvents.push(...events);
        }

        const lastPoint = agent.points[agent.points.length - 1];
        if (lastPoint) {
          allEvents.push(evaluator.complete(lastPoint.t));
        }
      }

      const summary = buildSessionSummary(
        session.sessionId,
        session.agents,
        allEvents,
        profilesConfig,
      );

      const html = renderReportHtml(session.agents, allEvents, summary, { backLink: '/' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

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
      server.close(() => resolve());
    });
  }

  return { server, start, stop };
}
