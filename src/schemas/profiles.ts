import { z } from 'zod';

export const BudgetsSchema = z.object({
  systemPrompt: z.number().min(0).max(1),
  toolDefinitions: z.number().min(0).max(1),
  working: z.number().min(0).max(1),
});

export type Budgets = z.infer<typeof BudgetsSchema>;

export const AlertsSchema = z.object({
  warningThreshold: z.number().min(0).max(1),
  dumbZoneThreshold: z.number().min(0).max(1),
  compactionTarget: z.number().min(0).max(1),
  maxTurnsInDumbZone: z.number().int().min(1),
  maxToolErrorRate: z.number().min(0).max(1),
  maxTurnsTotal: z.number().int().min(1),
});

export type Alerts = z.infer<typeof AlertsSchema>;

export const ContextWindowProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  model: z.string(),
  taskComplexity: z.enum(['retrieval', 'analysis', 'generation']),
  contextWindowTokens: z.number().int().positive(),
  budgets: BudgetsSchema,
  alerts: AlertsSchema,
});

export type ContextWindowProfile = z.infer<typeof ContextWindowProfileSchema>;

export const FallbackThresholdsSchema = z.object({
  opus: AlertsSchema.optional(),
  sonnet: AlertsSchema.optional(),
  haiku: AlertsSchema.optional(),
});

export type FallbackThresholds = z.infer<typeof FallbackThresholdsSchema>;

export const ProfilesConfigSchema = z.object({
  profiles: z.array(ContextWindowProfileSchema),
  fallbackThresholds: FallbackThresholdsSchema.optional(),
});

export type ProfilesConfig = z.infer<typeof ProfilesConfigSchema>;
