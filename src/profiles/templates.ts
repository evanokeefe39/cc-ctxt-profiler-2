import type { ContextWindowProfile } from '../schemas/index.js';
import { PROFILE_TEMPLATES } from '../schemas/index.js';

/**
 * Get a built-in profile template for a given task type.
 */
export function getTemplate(
  taskType: keyof typeof PROFILE_TEMPLATES,
  overrides?: { id?: string; label?: string; model?: string },
): ContextWindowProfile {
  const template = PROFILE_TEMPLATES[taskType];
  return {
    id: overrides?.id ?? taskType,
    label: overrides?.label ?? `${taskType} agent`,
    model: overrides?.model ?? 'claude-sonnet-4-5-20250929',
    budgets: { ...template.budgets },
    alerts: {
      warningThreshold: template.warningThreshold,
      dumbZoneThreshold: template.dumbZoneThreshold,
      compactionTarget: template.compactionTarget,
      maxTurnsInDumbZone: template.maxTurnsInDumbZone,
      maxToolErrorRate: template.maxToolErrorRate,
      expectedTurns: [...template.expectedTurns],
    },
  };
}

/**
 * Get all available template names.
 */
export function getTemplateNames(): string[] {
  return Object.keys(PROFILE_TEMPLATES);
}
