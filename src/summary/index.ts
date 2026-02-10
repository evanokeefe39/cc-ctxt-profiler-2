import type {
  AgentTimeSeries,
  DiagnosticEvent,
  SessionSummary,
  AgentSummary,
  ProfilesConfig,
} from '../schemas/index.js';
import { FALLBACK_THRESHOLDS } from '../schemas/index.js';
import { getEffectiveThresholds } from '../profiles/index.js';
import { classifyHealth } from './health-classifier.js';
import { generateInsights } from './insight-generator.js';
import { generateSuggestions, type SuggestionInput } from './suggestion-generator.js';

export { classifyHealth } from './health-classifier.js';
export { generateInsights } from './insight-generator.js';
export { generateSuggestions } from './suggestion-generator.js';

/**
 * Build a complete session summary from time series data and events.
 */
export function buildSessionSummary(
  sessionId: string,
  agents: AgentTimeSeries[],
  events: DiagnosticEvent[],
  profilesConfig?: ProfilesConfig,
): SessionSummary {
  const agentSummaries: AgentSummary[] = [];
  const suggestionInputs: SuggestionInput[] = [];
  const allInsights: SessionSummary['insights'] = [];

  for (const ts of agents) {
    const agentEvents = events.filter((e) => e.agentId === ts.agentId);
    const thresholds = getEffectiveThresholds(ts.agentId, ts.model, profilesConfig);

    const health = classifyHealth({
      timeSeries: ts,
      events: agentEvents,
      warningThreshold: thresholds.warningThreshold,
      dumbZoneThreshold: thresholds.dumbZoneThreshold,
      maxToolErrorRate: thresholds.maxToolErrorRate,
      expectedTurns: thresholds.expectedTurns,
    });

    const totalTurns = ts.points.length;
    const peakPct = totalTurns > 0 ? Math.max(...ts.points.map((p) => p.pct)) : 0;
    const finalPct = totalTurns > 0 ? ts.points[totalTurns - 1].pct : 0;
    const turnsInWarning = ts.points.filter((p) => p.pct >= thresholds.warningThreshold).length;
    const turnsInDumbZone = ts.points.filter((p) => p.pct >= thresholds.dumbZoneThreshold).length;

    // Compute tool error rate from events
    const toolSpikes = agentEvents.filter((e) => e.type === 'tool_error_spike');
    const toolErrorRate =
      toolSpikes.length > 0 ? (toolSpikes[toolSpikes.length - 1].data?.errorRate as number ?? 0) : 0;

    agentSummaries.push({
      agentId: ts.agentId,
      model: ts.model,
      health,
      totalTurns,
      peakPct,
      finalPct,
      turnsInWarning,
      turnsInDumbZone,
      compactions: ts.compactions.length,
      toolErrorRate,
      events: agentEvents,
    });

    // Collect insights
    const insights = generateInsights({
      timeSeries: ts,
      events: agentEvents,
      warningThreshold: thresholds.warningThreshold,
      dumbZoneThreshold: thresholds.dumbZoneThreshold,
    });
    allInsights.push(...insights);

    // Prepare suggestion input
    suggestionInputs.push({
      agentId: ts.agentId,
      health,
      timeSeries: ts,
      events: agentEvents,
      dumbZoneThreshold: thresholds.dumbZoneThreshold,
      warningThreshold: thresholds.warningThreshold,
      expectedTurns: thresholds.expectedTurns,
    });
  }

  const suggestions = generateSuggestions(suggestionInputs);

  // Overall health: worst of all agents
  let overallHealth: SessionSummary['overallHealth'] = 'healthy';
  if (agentSummaries.some((a) => a.health === 'unhealthy')) overallHealth = 'unhealthy';
  else if (agentSummaries.some((a) => a.health === 'degraded')) overallHealth = 'degraded';

  // Time range
  const allPoints = agents.flatMap((a) => a.points);
  const timestamps = allPoints.map((p) => p.t).sort();
  const startTime = timestamps[0] ?? new Date().toISOString();
  const endTime = timestamps[timestamps.length - 1] ?? startTime;

  return {
    sessionId,
    startTime,
    endTime,
    agents: agentSummaries,
    insights: allInsights,
    suggestions,
    overallHealth,
  };
}
