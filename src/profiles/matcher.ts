import type { ContextWindowProfile, ProfilesConfig } from '../schemas/index.js';
import { FALLBACK_THRESHOLDS } from '../schemas/index.js';

export interface MatchedProfile {
  profile: ContextWindowProfile;
  matchType: 'exact' | 'model-fallback';
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
 * Get effective thresholds for an agent — from matched profile or fallback.
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

  const fallback = config?.fallbackThresholds ?? FALLBACK_THRESHOLDS;
  return {
    ...fallback,
    profileId: undefined as string | undefined,
    matchType: 'none' as const,
  };
}
