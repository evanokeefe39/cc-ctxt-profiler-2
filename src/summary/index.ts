import type {
  AgentTimeSeries,
  DiagnosticEvent,
  SessionSummary,
  AgentSummary,
  ProfilesConfig,
} from '../schemas/index.js';
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
      maxTurnsTotal: thresholds.maxTurnsTotal,
    });

    const totalTurns = ts.points.length;
    const peakPct = totalTurns > 0 ? Math.max(...ts.points.map((p) => p.pct)) : 0;
    const finalPct = totalTurns > 0 ? ts.points[totalTurns - 1].pct : 0;
    const avgContextPct = totalTurns > 0
      ? ts.points.reduce((sum, p) => sum + p.pct, 0) / totalTurns
      : 0;
    const turnsInWarning = ts.points.filter((p) => p.pct >= thresholds.warningThreshold).length;
    const turnsInDumbZone = ts.points.filter((p) => p.pct >= thresholds.dumbZoneThreshold).length;

    // Compute tool stats from events
    const toolSpikes = agentEvents.filter((e) => e.type === 'tool_error_spike');
    const lastSpike = toolSpikes.length > 0 ? toolSpikes[toolSpikes.length - 1] : null;
    const toolErrorRate = lastSpike ? (lastSpike.data?.errorRate as number ?? 0) : 0;
    const toolCallCount = lastSpike ? (lastSpike.data?.totalCalls as number ?? 0) : 0;
    const toolErrorCount = lastSpike ? (lastSpike.data?.totalErrors as number ?? 0) : 0;

    // Compute event counts by type
    const eventCounts: Record<string, number> = {};
    for (const evt of agentEvents) {
      eventCounts[evt.type] = (eventCounts[evt.type] ?? 0) + 1;
    }

    agentSummaries.push({
      agentId: ts.agentId,
      model: ts.model,
      health,
      profileId: thresholds.profileId,
      totalTurns,
      peakPct,
      finalPct,
      avgContextPct,
      turnsInWarning,
      turnsInDumbZone,
      compactions: ts.compactions.length,
      toolCallCount,
      toolErrorCount,
      toolErrorRate,
      eventCounts,
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
      maxTurnsTotal: thresholds.maxTurnsTotal,
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

  // Total duration in ms
  const totalDuration = new Date(endTime).getTime() - new Date(startTime).getTime();

  return {
    sessionId,
    startTime,
    endTime,
    totalDuration,
    agents: agentSummaries,
    insights: allInsights,
    suggestions,
    overallHealth,
  };
}
