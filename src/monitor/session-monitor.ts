import { basename } from 'node:path';
import { appendFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import type {
  AgentTimeSeries,
  DiagnosticEvent,
  TranscriptLine,
  ProfilesConfig,
  SessionSummary,
} from '../schemas/index.js';
import { buildAgentTimeSeries, parseSession } from '../parser/index.js';
import { getEffectiveThresholds } from '../profiles/index.js';
import { EventEvaluator } from '../engine/index.js';
import { extractToolStats } from '../engine/tool-extractor.js';
import { buildSessionSummary } from '../summary/index.js';
import { createDashboardServer, type DashboardServer } from '../dashboard/index.js';
import { renderAgentSvg } from '../dashboard/svg-renderer.js';
import { insertLines, insertEvents, updateAgentStats } from '../db/ingest.js';
import { FileWatcher } from './file-watcher.js';

export interface SessionMonitorOptions {
  sessionDir: string;
  profilesConfig?: ProfilesConfig;
  port?: number;
  eventsLogFile?: string;
  onEvent?: (event: DiagnosticEvent) => void;
  /** Optional SQLite database for persistence (dual-write). */
  db?: Database;
  /** Project key for SQLite persistence. */
  projectKey?: string;
  /** Session ID for SQLite persistence. */
  sessionId?: string;
}

/**
 * Orchestrator: loads profiles, discovers sessions, creates evaluators per agent,
 * wires file watcher → parser → time-series → evaluator → dashboard SSE.
 */
export class SessionMonitor {
  private options: SessionMonitorOptions;
  private fileWatcher: FileWatcher | null = null;
  private dashboard: DashboardServer | null = null;
  private evaluators = new Map<string, EventEvaluator>();
  private agentLines = new Map<string, TranscriptLine[]>();
  private allEvents: DiagnosticEvent[] = [];
  private agents: AgentTimeSeries[] = [];

  constructor(options: SessionMonitorOptions) {
    this.options = options;
  }

  /**
   * Start monitoring: load existing data, start file watcher, start dashboard.
   */
  async start(): Promise<string> {
    const { sessionDir, profilesConfig, port = 8411 } = this.options;

    // Load existing session data
    const existing = parseSession(sessionDir);
    if (existing) {
      this.agents = existing.agents;
      // Initialize evaluators and replay existing data
      for (const agent of existing.agents) {
        this.initEvaluator(agent.agentId, agent.model);
        // Replay points through evaluator
        for (const point of agent.points) {
          const events = this.evaluators.get(agent.agentId)!.evaluateTurn(point);
          this.allEvents.push(...events);
        }
      }
    }

    // Start dashboard
    this.dashboard = createDashboardServer();
    this.updateDashboard();
    const url = await this.dashboard.start(port);

    // Start file watcher
    this.fileWatcher = new FileWatcher({
      sessionDir,
      onLines: (filePath, lines) => this.handleNewLines(filePath, lines),
      onNewFile: (filePath) => {
        const name = basename(filePath, '.jsonl');
        console.log(`[context-diag] Discovered file: ${name}`);
      },
    });
    await this.fileWatcher.start();

    return url;
  }

  /**
   * Stop monitoring.
   */
  async stop(): Promise<void> {
    // Emit completion events
    for (const [agentId, evaluator] of this.evaluators) {
      const ts = this.agents.find((a) => a.agentId === agentId);
      const lastPoint = ts?.points[ts.points.length - 1];
      if (lastPoint) {
        const event = evaluator.complete(lastPoint.t);
        this.allEvents.push(event);
        this.logEvent(event);
      }
    }

    await this.fileWatcher?.stop();
    await this.dashboard?.stop();
  }

  /**
   * Get the current session summary.
   */
  getSummary(): SessionSummary | null {
    if (this.agents.length === 0) return null;
    const sessionId = this.agents[0]?.agentId ?? 'unknown';
    return buildSessionSummary(sessionId, this.agents, this.allEvents, this.options.profilesConfig);
  }

  private handleNewLines(filePath: string, lines: TranscriptLine[]): void {
    const name = basename(filePath, '.jsonl');

    // Accumulate lines per agent
    const existing = this.agentLines.get(name) ?? [];
    existing.push(...lines);
    this.agentLines.set(name, existing);

    // Rebuild time series for this agent
    const ts = buildAgentTimeSeries(name, name, existing);

    // Update or add to agents list
    const idx = this.agents.findIndex((a) => a.agentId === name);
    if (idx >= 0) {
      this.agents[idx] = ts;
    } else {
      this.agents.push(ts);
    }

    // Get model from new lines
    const model = lines.find((l) => l.message.model)?.message.model ?? 'unknown';

    // Initialize evaluator if needed
    if (!this.evaluators.has(name)) {
      this.initEvaluator(name, model);
    }

    // Process new assistant lines through evaluator
    const evaluator = this.evaluators.get(name)!;
    const assistantLines = lines.filter(
      (l) => l.type === 'assistant' && l.message.usage,
    );

    const turnEvents: DiagnosticEvent[] = [];

    for (let i = 0; i < assistantLines.length; i++) {
      const line = assistantLines[i];
      const usage = line.message.usage!;
      const abs =
        usage.input_tokens +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      const pct = abs / (ts.limit || 200000);

      // Extract tool stats
      const nextUserLine = lines.find(
        (l) => l.type === 'user' && l.parentUuid === line.uuid,
      );
      const toolStats = extractToolStats(line, nextUserLine ?? undefined);

      const events = evaluator.evaluateTurn(
        { t: line.timestamp, abs, pct },
        toolStats.toolUseCount,
        toolStats.toolErrorCount,
      );

      for (const event of events) {
        this.allEvents.push(event);
        turnEvents.push(event);
        this.logEvent(event);
        this.options.onEvent?.(event);

        // Broadcast event to SSE clients
        this.dashboard?.sse.broadcast('diagnostic_event', {
          event,
          html: renderEventHtml(event),
        });
      }
    }

    // Dual-write to SQLite if configured
    const { db, projectKey, sessionId } = this.options;
    if (db && projectKey && sessionId) {
      insertLines(db, lines, projectKey, sessionId, name);
      if (turnEvents.length > 0) {
        insertEvents(db, turnEvents, projectKey, sessionId);
      }
      updateAgentStats(db, projectKey, sessionId, name);
    }

    // Broadcast agent update
    if (this.dashboard) {
      const svg = renderAgentSvg(ts);
      this.dashboard.sse.broadcast('agent_update', {
        agentId: name,
        html: renderAgentCardHtml(ts, svg),
      });

      // Update summary
      this.updateDashboard();
    }
  }

  private initEvaluator(agentId: string, model: string): void {
    const thresholds = getEffectiveThresholds(agentId, model, this.options.profilesConfig);
    this.evaluators.set(
      agentId,
      new EventEvaluator({
        agentId,
        profileId: thresholds.profileId,
        warningThreshold: thresholds.warningThreshold,
        dumbZoneThreshold: thresholds.dumbZoneThreshold,
        compactionTarget: thresholds.compactionTarget,
        maxTurnsInDumbZone: thresholds.maxTurnsInDumbZone,
        maxToolErrorRate: thresholds.maxToolErrorRate,
        maxTurnsTotal: thresholds.maxTurnsTotal,
      }),
    );
  }

  private updateDashboard(): void {
    if (!this.dashboard) return;
    const summary = this.getSummary();
    this.dashboard.updateState({
      agents: this.agents,
      events: this.allEvents,
      summary,
    });
  }

  private logEvent(event: DiagnosticEvent): void {
    if (this.options.eventsLogFile) {
      try {
        appendFileSync(this.options.eventsLogFile, JSON.stringify(event) + '\n');
      } catch {
        // ignore
      }
    }

    const severityColors: Record<string, string> = {
      info: '\x1b[36m',
      warning: '\x1b[33m',
      critical: '\x1b[31m',
    };
    const color = severityColors[event.severity] ?? '';
    const reset = '\x1b[0m';
    console.log(`${color}[${event.severity}]${reset} ${event.message}`);
  }
}

function renderEventHtml(event: DiagnosticEvent): string {
  return `<div class="event-card rounded border border-border bg-muted/30 px-3 py-2 text-xs">
    <div class="flex items-center justify-between mb-0.5">
      <span class="font-medium severity-${event.severity}">${event.type}</span>
      <span class="text-muted-foreground">${event.timestamp}</span>
    </div>
    <p class="text-muted-foreground">${event.message}</p>
  </div>`;
}

function renderAgentCardHtml(ts: AgentTimeSeries, svg: string): string {
  return `<div id="agent-${ts.agentId.replace(/[^a-zA-Z0-9-_]/g, '_')}" class="rounded-lg border border-border bg-card overflow-hidden">
    <div class="p-4 pb-2 flex items-center justify-between">
      <div>
        <span class="text-sm font-medium">${ts.label}</span>
        <span class="text-xs text-muted-foreground ml-2">${ts.model}</span>
      </div>
    </div>
    <div class="px-2 pb-2">${svg}</div>
  </div>`;
}
