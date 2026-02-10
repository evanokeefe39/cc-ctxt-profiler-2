import type { AgentTimeSeries, DiagnosticEvent, HealthGrade } from '../schemas/index.js';

export interface HealthInput {
  timeSeries: AgentTimeSeries;
  events: DiagnosticEvent[];
  warningThreshold: number;
  dumbZoneThreshold: number;
  maxToolErrorRate: number;
  expectedTurns: [number, number];
}

/**
 * Classify an agent's health based on its time series and diagnostic events.
 *
 * **healthy:** ≤20% turns in warning, no dz lingering, error rate OK
 * **degraded:** >20% warning or entered dz but compacted, or marginal errors
 * **unhealthy:** lingered in dz, budget overrun, high errors, >2x expected turns
 */
export function classifyHealth(input: HealthInput): HealthGrade {
  const { timeSeries, events, warningThreshold, dumbZoneThreshold, maxToolErrorRate, expectedTurns } = input;
  const totalTurns = timeSeries.points.length;
  if (totalTurns === 0) return 'healthy';

  const turnsInWarning = timeSeries.points.filter((p) => p.pct >= warningThreshold).length;
  const turnsInDumbZone = timeSeries.points.filter((p) => p.pct >= dumbZoneThreshold).length;
  const warningPct = turnsInWarning / totalTurns;

  const hasLingering = events.some((e) => e.type === 'dumbzone_lingering');
  const hasBudgetOverrun = events.some((e) => e.type === 'budget_overrun');
  const hasToolSpike = events.some((e) => e.type === 'tool_error_spike');
  const enteredDz = events.some((e) => e.type === 'dumbzone_entered');
  const hasCompaction = events.some((e) => e.type === 'compaction_detected');

  // Unhealthy conditions
  if (hasLingering) return 'unhealthy';
  if (hasBudgetOverrun) return 'unhealthy';
  if (totalTurns > expectedTurns[1] * 2) return 'unhealthy';
  if (hasToolSpike && turnsInDumbZone > 0) return 'unhealthy';

  // Degraded conditions
  if (warningPct > 0.20) return 'degraded';
  if (enteredDz && hasCompaction) return 'degraded';
  if (hasToolSpike) return 'degraded';
  if (totalTurns > expectedTurns[1]) return 'degraded';

  return 'healthy';
}
