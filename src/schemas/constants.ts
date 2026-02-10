/**
 * Model context window limits and default thresholds.
 */

export const MODEL_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  // Older models
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-sonnet-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,
};

export const DEFAULT_CONTEXT_LIMIT = 200_000;

/** If pct drops by more than this between consecutive points, it's a compaction. */
export const COMPACTION_DROP_THRESHOLD = 0.05;

/** Fallback thresholds when no profile matches. */
export const FALLBACK_THRESHOLDS = {
  warningThreshold: 0.70,
  dumbZoneThreshold: 0.85,
  compactionTarget: 0.50,
  maxTurnsInDumbZone: 3,
  maxToolErrorRate: 0.15,
  expectedTurns: [10, 40] as [number, number],
};

/** Built-in profile templates keyed by task type. */
export const PROFILE_TEMPLATES = {
  retrieval: {
    warningThreshold: 0.70,
    dumbZoneThreshold: 0.85,
    compactionTarget: 0.50,
    maxTurnsInDumbZone: 3,
    maxToolErrorRate: 0.15,
    expectedTurns: [10, 30] as [number, number],
    budgets: {
      systemPrompt: 0.10,
      conversation: 0.50,
      toolResults: 0.30,
      outputReserve: 0.10,
    },
  },
  analysis: {
    warningThreshold: 0.50,
    dumbZoneThreshold: 0.65,
    compactionTarget: 0.35,
    maxTurnsInDumbZone: 2,
    maxToolErrorRate: 0.10,
    expectedTurns: [5, 20] as [number, number],
    budgets: {
      systemPrompt: 0.15,
      conversation: 0.40,
      toolResults: 0.35,
      outputReserve: 0.10,
    },
  },
  generation: {
    warningThreshold: 0.60,
    dumbZoneThreshold: 0.75,
    compactionTarget: 0.40,
    maxTurnsInDumbZone: 3,
    maxToolErrorRate: 0.12,
    expectedTurns: [8, 25] as [number, number],
    budgets: {
      systemPrompt: 0.10,
      conversation: 0.45,
      toolResults: 0.25,
      outputReserve: 0.20,
    },
  },
} as const;
