import type { ContextWindowProfile, ProfilesConfig, Alerts } from '../schemas/index.js';
import { FALLBACK_THRESHOLDS, DEFAULT_ALERTS } from '../schemas/index.js';

export interface MatchedProfile {
  profile: ContextWindowProfile;
  matchType: 'exact' | 'model-fallback';
}

/**
 * Extract model family (opus/sonnet/haiku) from a model string.
 */
export function extractModelFamily(model: string): 'opus' | 'sonnet' | 'haiku' | null {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

/**
 * Match an agent ID to a profile.
 * 1. Exact ID match
 * 2. Model-based fallback from profiles with matching model
 * 3. undefined if no match
 */
export function matchProfile(
  agentId: string,
  model: string,
  config: ProfilesConfig | undefined,
): MatchedProfile | undefined {
  if (!config) return undefined;

  // 1. Exact ID match
  const exact = config.profiles.find((p) => p.id === agentId);
  if (exact) return { profile: exact, matchType: 'exact' };

  // 2. Model-based fallback — find first profile with matching model
  const modelMatch = config.profiles.find((p) => p.model === model);
  if (modelMatch) return { profile: modelMatch, matchType: 'model-fallback' };

  return undefined;
}

/**
 * Get effective thresholds for an agent — from matched profile or per-model fallback.
 */
export function getEffectiveThresholds(
  agentId: string,
  model: string,
  config: ProfilesConfig | undefined,
) {
  const match = matchProfile(agentId, model, config);
  if (match) {
    return {
      ...match.profile.alerts,
      profileId: match.profile.id,
      matchType: match.matchType,
    };
  }

  // Per-model fallback from config or built-in defaults
  const family = extractModelFamily(model);
  const configFallback = config?.fallbackThresholds;

  let alerts: Alerts | typeof DEFAULT_ALERTS;
  if (configFallback && family && configFallback[family]) {
    alerts = configFallback[family];
  } else if (family) {
    alerts = FALLBACK_THRESHOLDS[family];
  } else {
    alerts = DEFAULT_ALERTS;
  }

  return {
    ...alerts,
    profileId: undefined as string | undefined,
    matchType: 'none' as const,
  };
}
