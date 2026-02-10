import type { ProfilesConfig } from '../schemas/index.js';
import { MODEL_LIMITS } from '../schemas/index.js';

export interface ValidationError {
  profileId: string | null;
  field: string;
  message: string;
}

/**
 * Validate a profiles config beyond what Zod checks.
 * Returns an array of validation errors (empty = valid).
 */
export function validateProfiles(config: ProfilesConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for duplicate IDs
  const ids = config.profiles.map((p) => p.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      errors.push({
        profileId: id,
        field: 'id',
        message: `Duplicate profile ID: "${id}"`,
      });
    }
    seen.add(id);
  }

  for (const profile of config.profiles) {
    // warningThreshold < dumbZoneThreshold
    if (profile.alerts.warningThreshold >= profile.alerts.dumbZoneThreshold) {
      errors.push({
        profileId: profile.id,
        field: 'alerts.warningThreshold',
        message: `warningThreshold (${profile.alerts.warningThreshold}) must be less than dumbZoneThreshold (${profile.alerts.dumbZoneThreshold})`,
      });
    }

    // compactionTarget < dumbZoneThreshold
    if (profile.alerts.compactionTarget >= profile.alerts.dumbZoneThreshold) {
      errors.push({
        profileId: profile.id,
        field: 'alerts.compactionTarget',
        message: `compactionTarget (${profile.alerts.compactionTarget}) must be less than dumbZoneThreshold (${profile.alerts.dumbZoneThreshold})`,
      });
    }

    // Budgets sum ≈ 1.0 (0.95-1.05)
    const budgetSum =
      profile.budgets.systemPrompt +
      profile.budgets.conversation +
      profile.budgets.toolResults +
      profile.budgets.outputReserve;
    if (budgetSum < 0.95 || budgetSum > 1.05) {
      errors.push({
        profileId: profile.id,
        field: 'budgets',
        message: `Budget allocations sum to ${budgetSum.toFixed(3)}, expected ~1.0 (0.95-1.05)`,
      });
    }

    // expectedTurns[0] <= expectedTurns[1]
    if (profile.alerts.expectedTurns[0] > profile.alerts.expectedTurns[1]) {
      errors.push({
        profileId: profile.id,
        field: 'alerts.expectedTurns',
        message: `expectedTurns min (${profile.alerts.expectedTurns[0]}) must be <= max (${profile.alerts.expectedTurns[1]})`,
      });
    }

    // Model name recognized
    if (!(profile.model in MODEL_LIMITS)) {
      errors.push({
        profileId: profile.id,
        field: 'model',
        message: `Unrecognized model: "${profile.model}". Known models: ${Object.keys(MODEL_LIMITS).join(', ')}`,
      });
    }
  }

  return errors;
}
