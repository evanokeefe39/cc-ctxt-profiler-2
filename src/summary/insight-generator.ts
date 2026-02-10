import type { AgentTimeSeries, DiagnosticEvent, Insight } from '../schemas/index.js';

export interface InsightInput {
  timeSeries: AgentTimeSeries;
  events: DiagnosticEvent[];
  warningThreshold: number;
  dumbZoneThreshold: number;
}

/**
 * Generate rule-based insights for an agent.
 */
export function generateInsights(input: InsightInput): Insight[] {
  const { timeSeries, events, warningThreshold, dumbZoneThreshold } = input;
  const insights: Insight[] = [];
  const agentId = timeSeries.agentId;
  const totalTurns = timeSeries.points.length;

  if (totalTurns === 0) return insights;

  // Dumb zone time percentage
  const dzTurns = timeSeries.points.filter((p) => p.pct >= dumbZoneThreshold).length;
  if (dzTurns > 0) {
    const dzPct = ((dzTurns / totalTurns) * 100).toFixed(1);
    insights.push({
      agentId,
      category: 'dumb-zone',
      message: `Spent ${dzPct}% of turns (${dzTurns}/${totalTurns}) in the dumb zone`,
    });
  }

  // Peak context usage
  const peakPct = Math.max(...timeSeries.points.map((p) => p.pct));
  const peakAbs = Math.max(...timeSeries.points.map((p) => p.abs));
  insights.push({
    agentId,
    category: 'peak-usage',
    message: `Peak context usage: ${(peakPct * 100).toFixed(1)}% (${(peakAbs / 1000).toFixed(0)}k tokens)`,
  });

  // Compaction effectiveness
  const compactions = timeSeries.compactions;
  if (compactions.length > 0) {
    const avgReduction =
      compactions.reduce((sum, c) => sum + (c.before - c.after), 0) / compactions.length;
    insights.push({
      agentId,
      category: 'compaction',
      message: `${compactions.length} compaction(s) with average reduction of ${(avgReduction / 1000).toFixed(0)}k tokens`,
    });
  }

  // Tool error patterns
  const toolErrors = events.filter((e) => e.type === 'tool_error_spike');
  if (toolErrors.length > 0) {
    const lastError = toolErrors[toolErrors.length - 1];
    insights.push({
      agentId,
      category: 'tool-errors',
      message: `Tool error rate spiked — cumulative rate: ${((lastError.data?.errorRate as number ?? 0) * 100).toFixed(1)}%`,
    });
  }

  // Unmatched agent
  if (events.some((e) => e.type === 'unmatched_agent')) {
    insights.push({
      agentId,
      category: 'profile',
      message: `No profile matched — using fallback thresholds. Consider creating a profile for this agent.`,
    });
  }

  // Warning zone time
  const warnTurns = timeSeries.points.filter(
    (p) => p.pct >= warningThreshold && p.pct < dumbZoneThreshold,
  ).length;
  if (warnTurns > 0) {
    insights.push({
      agentId,
      category: 'warning-zone',
      message: `Spent ${warnTurns} turns in warning zone (${warningThreshold * 100}%-${dumbZoneThreshold * 100}%)`,
    });
  }

  return insights;
}
