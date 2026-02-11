import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { EventEvaluator } from '../engine/event-evaluator.js';
import { getEffectiveThresholds } from '../profiles/matcher.js';
import { buildSessionSummary } from '../summary/index.js';
import {
  listSessions,
  listSessionsByProject,
  listProjects,
  getSessionAgents,
  getSessionMessages,
  getSessionToolCalls,
} from '../db/queries.js';
import { ingestAll } from '../db/ingest.js';
import { renderLayout } from './layout.js';
import { renderBreadcrumb } from './partials/breadcrumb.js';
import { renderProjectList } from './partials/project-list.js';
import { renderSessionList } from './partials/session-list.js';
import { renderSessionDetail } from './partials/session-detail.js';
import { renderAgentsTab } from './partials/agents-tab.js';
import { renderMessagesTab } from './partials/messages-tab.js';
import { renderToolCallsTab, computeToolStats } from './partials/tool-calls-tab.js';
import { renderEventsTab } from './partials/events-tab.js';
import type { DiagnosticEvent, ProfilesConfig } from '../schemas/index.js';

export interface BrowseServer {
  app: Hono;
  start: (port: number) => Promise<string>;
  stop: () => Promise<void>;
}

/** Evaluate events for a session at query time with fresh profile config. */
function evaluateSessionEvents(
  db: Database,
  projectKey: string,
  sessionId: string,
  profilesConfig?: ProfilesConfig,
): { agents: ReturnType<typeof getSessionAgents>; events: DiagnosticEvent[]; summary: ReturnType<typeof buildSessionSummary> } {
  const agents = getSessionAgents(db, projectKey, sessionId);
  const allEvents: DiagnosticEvent[] = [];

  for (const agent of agents) {
    const thresholds = getEffectiveThresholds(agent.agentId, agent.model, profilesConfig);
    agent.threshold = thresholds.dumbZoneThreshold;
    agent.warningThreshold = thresholds.warningThreshold;

    const evaluator = new EventEvaluator({
      agentId: agent.agentId,
      profileId: thresholds.profileId,
      warningThreshold: thresholds.warningThreshold,
      dumbZoneThreshold: thresholds.dumbZoneThreshold,
      compactionTarget: thresholds.compactionTarget,
      maxTurnsInDumbZone: thresholds.maxTurnsInDumbZone,
      maxToolErrorRate: thresholds.maxToolErrorRate,
      maxTurnsTotal: thresholds.maxTurnsTotal,
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

  const summary = buildSessionSummary(sessionId, agents, allEvents, profilesConfig);
  return { agents, events: allEvents, summary };
}

function isHxRequest(c: { req: { header: (name: string) => string | undefined } }): boolean {
  return c.req.header('HX-Request') === 'true';
}

export function createBrowseServer(
  db: Database,
  projectsDir: string,
  profilesConfig?: ProfilesConfig,
): BrowseServer {
  const app = new Hono();

  // ─── Full-page routes (return layout or partial based on HX-Request) ───

  // GET / → project list
  app.get('/', (c) => {
    ingestAll(db, projectsDir);
    const projects = listProjects(db);
    const content = renderProjectList(projects);
    const breadcrumb = renderBreadcrumb([{ label: 'Projects' }]);

    if (isHxRequest(c)) {
      return c.html(breadcrumb + content);
    }
    return c.html(renderLayout({ title: 'Projects — context-diag', breadcrumb, content }));
  });

  // GET /project/:projectKey → session list
  app.get('/project/:projectKey', (c) => {
    const projectKey = c.req.param('projectKey');
    ingestAll(db, projectsDir);
    const sessions = listSessionsByProject(db, projectKey);
    const projectName = sessions[0]?.projectName ?? projectKey;
    const content = renderSessionList(projectKey, projectName, sessions);
    const breadcrumb = renderBreadcrumb([
      { label: 'Projects', href: '/' },
      { label: projectName },
    ]);

    if (isHxRequest(c)) {
      return c.html(breadcrumb + content);
    }
    return c.html(renderLayout({ title: `${projectName} — context-diag`, breadcrumb, content }));
  });

  // GET /session/:projectKey/:sessionId → session detail
  app.get('/session/:projectKey/:sessionId', (c) => {
    const projectKey = c.req.param('projectKey');
    const sessionId = c.req.param('sessionId');
    ingestAll(db, projectsDir);

    const { agents, events, summary } = evaluateSessionEvents(db, projectKey, sessionId, profilesConfig);
    if (agents.length === 0) {
      return c.text('Session not found', 404);
    }

    const sessions = listSessionsByProject(db, projectKey);
    const projectName = sessions[0]?.projectName ?? projectKey;
    const content = renderSessionDetail(projectKey, sessionId, summary, agents, events);
    const breadcrumb = renderBreadcrumb([
      { label: 'Projects', href: '/' },
      { label: projectName, href: `/project/${encodeURIComponent(projectKey)}` },
      { label: sessionId.slice(0, 8) },
    ]);

    if (isHxRequest(c)) {
      return c.html(breadcrumb + content);
    }
    return c.html(renderLayout({ title: `Session ${sessionId.slice(0, 8)} — context-diag`, breadcrumb, content }));
  });

  // ─── Partial routes (always return fragment only) ───

  app.get('/partials/projects', (c) => {
    ingestAll(db, projectsDir);
    const projects = listProjects(db);
    return c.html(renderProjectList(projects));
  });

  app.get('/partials/sessions/:projectKey', (c) => {
    const projectKey = c.req.param('projectKey');
    ingestAll(db, projectsDir);
    const sessions = listSessionsByProject(db, projectKey);
    const projectName = sessions[0]?.projectName ?? projectKey;
    return c.html(renderSessionList(projectKey, projectName, sessions));
  });

  app.get('/partials/detail/:projectKey/:sessionId', (c) => {
    const projectKey = c.req.param('projectKey');
    const sessionId = c.req.param('sessionId');
    ingestAll(db, projectsDir);

    const { agents, events, summary } = evaluateSessionEvents(db, projectKey, sessionId, profilesConfig);
    if (agents.length === 0) {
      return c.text('Session not found', 404);
    }

    return c.html(renderSessionDetail(projectKey, sessionId, summary, agents, events));
  });

  app.get('/partials/agents/:projectKey/:sessionId', (c) => {
    const projectKey = c.req.param('projectKey');
    const sessionId = c.req.param('sessionId');
    ingestAll(db, projectsDir);

    const { agents, events, summary } = evaluateSessionEvents(db, projectKey, sessionId, profilesConfig);
    return c.html(renderAgentsTab(agents, events, sessionId));
  });

  app.get('/partials/messages/:projectKey/:sessionId/:agentId', (c) => {
    const projectKey = c.req.param('projectKey');
    const sessionId = c.req.param('sessionId');
    const agentId = c.req.param('agentId');
    ingestAll(db, projectsDir);

    const agents = getSessionAgents(db, projectKey, sessionId);
    const messages = getSessionMessages(db, projectKey, sessionId, agentId);
    return c.html(renderMessagesTab(messages, agents, projectKey, sessionId, agentId));
  });

  app.get('/partials/tools/:projectKey/:sessionId', (c) => {
    const projectKey = c.req.param('projectKey');
    const sessionId = c.req.param('sessionId');
    ingestAll(db, projectsDir);

    const toolCalls = getSessionToolCalls(db, projectKey, sessionId);
    const stats = computeToolStats(toolCalls);
    return c.html(renderToolCallsTab(toolCalls, stats));
  });

  app.get('/partials/tools/:projectKey/:sessionId/:agentId', (c) => {
    const projectKey = c.req.param('projectKey');
    const sessionId = c.req.param('sessionId');
    const agentId = c.req.param('agentId');
    ingestAll(db, projectsDir);

    const toolCalls = getSessionToolCalls(db, projectKey, sessionId, agentId);
    const stats = computeToolStats(toolCalls);
    return c.html(renderToolCallsTab(toolCalls, stats));
  });

  app.get('/partials/events/:projectKey/:sessionId', (c) => {
    const projectKey = c.req.param('projectKey');
    const sessionId = c.req.param('sessionId');
    ingestAll(db, projectsDir);

    const { events } = evaluateSessionEvents(db, projectKey, sessionId, profilesConfig);
    return c.html(renderEventsTab(events));
  });

  // ─── API route (compatibility) ───

  app.get('/api/sessions', (c) => {
    ingestAll(db, projectsDir);
    const entries = listSessions(db);
    return c.json(entries);
  });

  // ─── Server lifecycle ───

  let bunServer: ReturnType<typeof Bun.serve> | null = null;

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
    bunServer?.stop();
    bunServer = null;
    return Promise.resolve();
  }

  return { app, start, stop };
}
