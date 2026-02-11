import { Command } from 'commander';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseSession } from '../../parser/index.js';
import { loadProfiles } from '../../profiles/loader.js';
import { EventEvaluator } from '../../engine/event-evaluator.js';
import { getEffectiveThresholds } from '../../profiles/matcher.js';
import { buildSessionSummary } from '../../summary/index.js';
import { renderLayout, escapeHtml } from '../../dashboard/layout.js';
import { renderBreadcrumb } from '../../dashboard/partials/breadcrumb.js';
import { renderAgentsTab } from '../../dashboard/partials/agents-tab.js';
import { renderEventsTab } from '../../dashboard/partials/events-tab.js';
import type { AgentTimeSeries, DiagnosticEvent, ProfilesConfig, SessionSummary } from '../../schemas/index.js';

export const analyzeCommand = new Command('analyze')
  .description('Generate a static HTML analysis report')
  .requiredOption('--session <dir>', 'Session directory to analyze')
  .option('--profiles <file>', 'Path to context-profiles.json')
  .option('--output <file>', 'Output file path (default: report.html in session dir)')
  .action(async (opts) => {
    const sessionDir = resolve(opts.session);
    if (!existsSync(sessionDir)) {
      console.error(`Session directory not found: ${sessionDir}`);
      process.exit(1);
    }

    let profilesConfig: ProfilesConfig | undefined;
    if (opts.profiles) {
      try {
        profilesConfig = loadProfiles(resolve(opts.profiles));
      } catch (err) {
        console.error(`Failed to load profiles: ${err}`);
        process.exit(1);
      }
    }

    console.log(`Analyzing session: ${sessionDir}`);
    const session = parseSession(sessionDir);
    if (!session) {
      console.error('No session data found in directory');
      process.exit(1);
    }

    console.log(`Found ${session.agents.length} agent(s)`);

    // Run evaluators on all agents
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
        maxTurnsTotal: thresholds.maxTurnsTotal,
      });

      for (const point of agent.points) {
        const events = evaluator.evaluateTurn(point);
        allEvents.push(...events);
      }

      // Emit completion event
      const lastPoint = agent.points[agent.points.length - 1];
      if (lastPoint) {
        allEvents.push(evaluator.complete(lastPoint.t));
      }
    }

    // Build summary
    const summary = buildSessionSummary(
      session.sessionId,
      session.agents,
      allEvents,
      profilesConfig,
    );

    // Render HTML
    const html = renderStaticReport(session.agents, allEvents, summary);

    // Write output
    const outputPath = opts.output
      ? resolve(opts.output)
      : join(sessionDir, 'report.html');

    writeFileSync(outputPath, html, 'utf-8');
    console.log(`\nReport written to: ${outputPath}`);
    console.log(`Overall health: ${summary.overallHealth}`);
    console.log(`Agents: ${summary.agents.map((a) => `${a.agentId} (${a.health})`).join(', ')}`);
    console.log(`Events: ${allEvents.length}`);
    console.log(`Suggestions: ${summary.suggestions.length}`);

    // Try to open
    try {
      const { exec } = await import('node:child_process');
      const cmd =
        process.platform === 'win32'
          ? `start "" "${outputPath}"`
          : process.platform === 'darwin'
            ? `open "${outputPath}"`
            : `xdg-open "${outputPath}"`;
      exec(cmd);
    } catch {
      // ignore
    }
  });

function renderStaticReport(
  agents: AgentTimeSeries[],
  events: DiagnosticEvent[],
  summary: SessionSummary,
): string {
  const agentsContent = renderAgentsTab(agents, events, summary.sessionId);
  const eventFeed = renderEventsTab(events);

  const summaryCards = summary.agents
    .map(
      (a) => `<div class="rounded border border-border p-2">
        <p class="text-xs text-muted-foreground">${escapeHtml(a.agentId)}</p>
        <p class="text-lg font-semibold health-${a.health}">${(a.peakPct * 100).toFixed(0)}%</p>
        <p class="text-xs text-muted-foreground">${a.totalTurns} turns</p>
      </div>`,
    )
    .join('\n');

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

  const content = `<div class="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
    <div class="space-y-6">${agentsContent}</div>
    <aside class="space-y-6">
      <div class="rounded-lg border border-border bg-card p-4 space-y-4">
        <h2 class="text-sm font-semibold">Session Summary</h2>
        <div class="grid grid-cols-2 gap-3">${summaryCards}</div>
        ${summary.insights.length > 0 ? `<div><h3 class="text-xs font-semibold text-muted-foreground mb-2">Insights</h3><ul class="space-y-1 list-disc list-inside">${insightsHtml}</ul></div>` : ''}
        ${summary.suggestions.length > 0 ? `<div><h3 class="text-xs font-semibold text-muted-foreground mb-2">Suggestions</h3><div class="space-y-2">${suggestionsHtml}</div></div>` : ''}
      </div>
      <div class="rounded-lg border border-border bg-card p-4">
        <h2 class="text-sm font-semibold mb-3">Events</h2>
        ${eventFeed}
      </div>
    </aside>
  </div>`;

  const breadcrumb = `<span class="text-foreground">Report</span>
    <span class="ml-3 text-xs font-medium health-${summary.overallHealth}">${summary.overallHealth.toUpperCase()}</span>`;

  return renderLayout({
    title: `Report — ${summary.sessionId} — context-diag`,
    breadcrumb,
    content,
  });
}
