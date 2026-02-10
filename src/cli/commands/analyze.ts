import { Command } from 'commander';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseSession } from '../../parser/index.js';
import { loadProfiles } from '../../profiles/loader.js';
import { EventEvaluator } from '../../engine/event-evaluator.js';
import { getEffectiveThresholds } from '../../profiles/matcher.js';
import { buildSessionSummary } from '../../summary/index.js';
import { renderReportHtml } from '../../dashboard/html-template.js';
import type { DiagnosticEvent, ProfilesConfig } from '../../schemas/index.js';

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
        expectedTurns: thresholds.expectedTurns,
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
    const html = renderReportHtml(session.agents, allEvents, summary);

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
