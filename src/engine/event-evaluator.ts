import { randomUUID } from 'node:crypto';
import type {
  TimeSeriesPoint,
  DiagnosticEvent,
  DiagnosticEventType,
  Severity,
} from '../schemas/index.js';
import { COMPACTION_DROP_THRESHOLD, DEFAULT_ALERTS } from '../schemas/index.js';

export interface EvaluatorConfig {
  agentId: string;
  profileId?: string;
  warningThreshold: number;
  dumbZoneThreshold: number;
  compactionTarget: number;
  maxTurnsInDumbZone: number;
  maxToolErrorRate: number;
  maxTurnsTotal: number;
}

interface EvaluatorState {
  prevPct: number;
  turnCount: number;
  warningCrossed: boolean;
  dumbzoneCrossed: boolean;
  consecutiveDumbZoneTurns: number;
  totalToolCalls: number;
  totalToolErrors: number;
  started: boolean;
}

/**
 * Stateful per-agent evaluator that processes turns and emits DiagnosticEvent objects.
 */
export class EventEvaluator {
  private config: EvaluatorConfig;
  private state: EvaluatorState;

  constructor(config: Partial<EvaluatorConfig> & { agentId: string }) {
    this.config = {
      warningThreshold: DEFAULT_ALERTS.warningThreshold,
      dumbZoneThreshold: DEFAULT_ALERTS.dumbZoneThreshold,
      compactionTarget: DEFAULT_ALERTS.compactionTarget,
      maxTurnsInDumbZone: DEFAULT_ALERTS.maxTurnsInDumbZone,
      maxToolErrorRate: DEFAULT_ALERTS.maxToolErrorRate,
      maxTurnsTotal: DEFAULT_ALERTS.maxTurnsTotal,
      ...config,
    };

    this.state = {
      prevPct: 0,
      turnCount: 0,
      warningCrossed: false,
      dumbzoneCrossed: false,
      consecutiveDumbZoneTurns: 0,
      totalToolCalls: 0,
      totalToolErrors: 0,
      started: false,
    };
  }

  /**
   * Evaluate a single turn and return any emitted diagnostic events.
   */
  evaluateTurn(
    point: TimeSeriesPoint,
    toolCalls: number = 0,
    toolErrors: number = 0,
  ): DiagnosticEvent[] {
    const events: DiagnosticEvent[] = [];
    const { config, state } = this;

    state.turnCount++;
    state.totalToolCalls += toolCalls;
    state.totalToolErrors += toolErrors;

    // agent_started — on first turn
    if (!state.started) {
      state.started = true;
      events.push(
        this.emit(point.t, 'info', 'agent_started', `Agent ${config.agentId} started`, {
          model: config.profileId ?? 'unmatched',
        }),
      );

      // unmatched_agent — no profile match (warning severity)
      if (!config.profileId) {
        events.push(
          this.emit(
            point.t,
            'warning',
            'unmatched_agent',
            `Agent ${config.agentId} has no matching profile — using fallback thresholds`,
          ),
        );
      }
    }

    // 1. compaction_detected — pct dropped > threshold
    const drop = state.prevPct - point.pct;
    if (drop > COMPACTION_DROP_THRESHOLD && state.turnCount > 1) {
      events.push(
        this.emit(
          point.t,
          'info',
          'compaction_detected',
          `Compaction detected for ${config.agentId}: ${(state.prevPct * 100).toFixed(1)}% → ${(point.pct * 100).toFixed(1)}%`,
          { before: state.prevPct, after: point.pct },
        ),
      );

      // Reset warning/dumbzone flags after compaction
      state.warningCrossed = false;
      state.dumbzoneCrossed = false;
      state.consecutiveDumbZoneTurns = 0;

      // 2. compaction_insufficient — still above compactionTarget
      if (point.pct > config.compactionTarget) {
        events.push(
          this.emit(
            point.t,
            'warning',
            'compaction_insufficient',
            `Compaction for ${config.agentId} was insufficient: still at ${(point.pct * 100).toFixed(1)}% (target: ${(config.compactionTarget * 100).toFixed(1)}%)`,
            { pct: point.pct, target: config.compactionTarget },
          ),
        );
      }
    }

    // 3. warning_threshold_crossed — first upward crossing
    if (
      point.pct >= config.warningThreshold &&
      !state.warningCrossed
    ) {
      state.warningCrossed = true;
      events.push(
        this.emit(
          point.t,
          'warning',
          'warning_threshold_crossed',
          `Agent ${config.agentId} crossed warning threshold at ${(point.pct * 100).toFixed(1)}%`,
          { pct: point.pct, threshold: config.warningThreshold },
        ),
      );
    }

    // 4. dumbzone_entered — first upward crossing
    if (
      point.pct >= config.dumbZoneThreshold &&
      !state.dumbzoneCrossed
    ) {
      state.dumbzoneCrossed = true;
      events.push(
        this.emit(
          point.t,
          'critical',
          'dumbzone_entered',
          `Agent ${config.agentId} entered dumb zone at ${(point.pct * 100).toFixed(1)}%`,
          { pct: point.pct, threshold: config.dumbZoneThreshold },
        ),
      );
    }

    // Track consecutive dumb zone turns
    if (point.pct >= config.dumbZoneThreshold) {
      state.consecutiveDumbZoneTurns++;
    } else {
      state.consecutiveDumbZoneTurns = 0;
    }

    // 5. dumbzone_lingering — too many consecutive turns in dumb zone
    if (state.consecutiveDumbZoneTurns > config.maxTurnsInDumbZone) {
      events.push(
        this.emit(
          point.t,
          'critical',
          'dumbzone_lingering',
          `Agent ${config.agentId} has been in dumb zone for ${state.consecutiveDumbZoneTurns} consecutive turns (max: ${config.maxTurnsInDumbZone})`,
          {
            consecutiveTurns: state.consecutiveDumbZoneTurns,
            max: config.maxTurnsInDumbZone,
          },
        ),
      );
    }

    // 6. scope_creep — total turns > maxTurnsTotal
    if (state.turnCount > config.maxTurnsTotal) {
      events.push(
        this.emit(
          point.t,
          'warning',
          'scope_creep',
          `Agent ${config.agentId} has ${state.turnCount} turns, exceeding expected max of ${config.maxTurnsTotal}`,
          {
            turns: state.turnCount,
            expectedMax: config.maxTurnsTotal,
          },
        ),
      );
    }

    // 7. tool_error_spike — cumulative error rate > maxToolErrorRate
    if (state.totalToolCalls > 0) {
      const errorRate = state.totalToolErrors / state.totalToolCalls;
      if (errorRate > config.maxToolErrorRate) {
        events.push(
          this.emit(
            point.t,
            'warning',
            'tool_error_spike',
            `Agent ${config.agentId} tool error rate ${(errorRate * 100).toFixed(1)}% exceeds max ${(config.maxToolErrorRate * 100).toFixed(1)}%`,
            {
              errorRate,
              maxRate: config.maxToolErrorRate,
              totalCalls: state.totalToolCalls,
              totalErrors: state.totalToolErrors,
            },
          ),
        );
      }
    }

    state.prevPct = point.pct;
    return events;
  }

  /**
   * Emit an agent_completed event — call when the session ends.
   */
  complete(timestamp: string): DiagnosticEvent {
    return this.emit(
      timestamp,
      'info',
      'agent_completed',
      `Agent ${this.config.agentId} completed after ${this.state.turnCount} turns`,
      {
        totalTurns: this.state.turnCount,
        finalPct: this.state.prevPct,
      },
    );
  }

  getState() {
    return { ...this.state };
  }

  private emit(
    timestamp: string,
    severity: Severity,
    type: DiagnosticEventType,
    message: string,
    data?: Record<string, unknown>,
  ): DiagnosticEvent {
    return {
      id: randomUUID().slice(0, 8),
      timestamp,
      agentId: this.config.agentId,
      profileId: this.config.profileId,
      severity,
      type,
      message,
      data,
    };
  }
}
