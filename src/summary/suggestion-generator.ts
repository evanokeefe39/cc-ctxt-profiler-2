import type { AgentTimeSeries, DiagnosticEvent, Suggestion, HealthGrade } from '../schemas/index.js';

export interface SuggestionInput {
  agentId: string;
  health: HealthGrade;
  timeSeries: AgentTimeSeries;
  events: DiagnosticEvent[];
  dumbZoneThreshold: number;
  warningThreshold: number;
  expectedTurns: [number, number];
}

/**
 * Generate actionable suggestions sorted by priority (1 = highest).
 *
 * Triage order:
 * 1. Unhealthy agents
 * 2. Budget overruns
 * 3. Unmatched agents
 * 4. Threshold tuning
 * 5. Coordination issues
 */
export function generateSuggestions(inputs: SuggestionInput[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const input of inputs) {
    const { agentId, health, events, timeSeries, dumbZoneThreshold, warningThreshold, expectedTurns } = input;

    // P1: Unhealthy agents
    if (health === 'unhealthy') {
      const hasLingering = events.some((e) => e.type === 'dumbzone_lingering');
      if (hasLingering) {
        suggestions.push({
          priority: 1,
          agentId,
          message: `Agent "${agentId}" lingered in the dumb zone. Consider splitting this task into smaller sub-agents or reducing tool result sizes.`,
          action: 'Split task or add compaction triggers',
        });
      }

      const totalTurns = timeSeries.points.length;
      if (totalTurns > expectedTurns[1] * 2) {
        suggestions.push({
          priority: 1,
          agentId,
          message: `Agent "${agentId}" used ${totalTurns} turns (expected max: ${expectedTurns[1]}). This suggests scope creep or an inefficient approach.`,
          action: 'Review task scope and expected turn range',
        });
      }
    }

    // P2: Budget overruns
    if (events.some((e) => e.type === 'budget_overrun')) {
      suggestions.push({
        priority: 2,
        agentId,
        message: `Agent "${agentId}" exceeded budget allocations. Review system prompt and tool result sizes.`,
        action: 'Adjust budget allocations in profile',
      });
    }

    // P3: Unmatched agents
    if (events.some((e) => e.type === 'unmatched_agent')) {
      suggestions.push({
        priority: 3,
        agentId,
        message: `Agent "${agentId}" has no profile. Create a profile to tune thresholds for its workload pattern.`,
        action: 'Add profile to context-profiles.json',
      });
    }

    // P4: Threshold tuning
    if (health === 'degraded') {
      const peakPct = Math.max(...timeSeries.points.map((p) => p.pct));
      if (peakPct > warningThreshold && peakPct < dumbZoneThreshold) {
        suggestions.push({
          priority: 4,
          agentId,
          message: `Agent "${agentId}" peaked at ${(peakPct * 100).toFixed(1)}% — close to dumb zone. Consider lowering warningThreshold for earlier alerts.`,
          action: 'Adjust warningThreshold in profile',
        });
      }

      const toolSpikes = events.filter((e) => e.type === 'tool_error_spike');
      if (toolSpikes.length > 0) {
        suggestions.push({
          priority: 4,
          agentId,
          message: `Agent "${agentId}" experienced tool error spikes. Check for flaky tools or permissions issues.`,
          action: 'Investigate tool errors',
        });
      }
    }
  }

  // P5: Coordination issues (multi-agent)
  if (inputs.length > 1) {
    const unhealthyCount = inputs.filter((i) => i.health === 'unhealthy').length;
    if (unhealthyCount > 1) {
      suggestions.push({
        priority: 5,
        message: `${unhealthyCount} agents are unhealthy. Review how work is distributed across agents.`,
        action: 'Review agent coordination strategy',
      });
    }
  }

  // Sort by priority
  suggestions.sort((a, b) => a.priority - b.priority);
  return suggestions;
}
