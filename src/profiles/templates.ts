import type { ContextWindowProfile } from '../schemas/index.js';
import { PROFILE_TEMPLATES, DEFAULT_CONTEXT_LIMIT } from '../schemas/index.js';

/**
 * Get a built-in profile template for a given task type.
 */
export function getTemplate(
  taskType: keyof typeof PROFILE_TEMPLATES,
  overrides?: { id?: string; displayName?: string; model?: string; contextWindowTokens?: number },
): ContextWindowProfile {
  const template = PROFILE_TEMPLATES[taskType];
  return {
    id: overrides?.id ?? taskType,
    displayName: overrides?.displayName ?? `${taskType} agent`,
    model: overrides?.model ?? 'claude-sonnet-4-5-20250929',
    taskComplexity: taskType,
    contextWindowTokens: overrides?.contextWindowTokens ?? DEFAULT_CONTEXT_LIMIT,
    budgets: { ...template.budgets },
    alerts: {
      warningThreshold: template.warningThreshold,
      dumbZoneThreshold: template.dumbZoneThreshold,
      compactionTarget: template.compactionTarget,
      maxTurnsInDumbZone: template.maxTurnsInDumbZone,
      maxToolErrorRate: template.maxToolErrorRate,
      maxTurnsTotal: template.maxTurnsTotal,
    },
  };
}

/**
 * Get all available template names.
 */
export function getTemplateNames(): string[] {
  return Object.keys(PROFILE_TEMPLATES);
}
