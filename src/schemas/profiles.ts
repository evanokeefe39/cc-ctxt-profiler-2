import { z } from 'zod';

export const BudgetsSchema = z.object({
  systemPrompt: z.number().min(0).max(1),
  conversation: z.number().min(0).max(1),
  toolResults: z.number().min(0).max(1),
  outputReserve: z.number().min(0).max(1),
});

export type Budgets = z.infer<typeof BudgetsSchema>;

export const AlertsSchema = z.object({
  warningThreshold: z.number().min(0).max(1),
  dumbZoneThreshold: z.number().min(0).max(1),
  compactionTarget: z.number().min(0).max(1),
  maxTurnsInDumbZone: z.number().int().min(1),
  maxToolErrorRate: z.number().min(0).max(1),
  expectedTurns: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
});

export type Alerts = z.infer<typeof AlertsSchema>;

export const ContextWindowProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  model: z.string(),
  budgets: BudgetsSchema,
  alerts: AlertsSchema,
});

export type ContextWindowProfile = z.infer<typeof ContextWindowProfileSchema>;

export const FallbackThresholdsSchema = z.object({
  warningThreshold: z.number().min(0).max(1),
  dumbZoneThreshold: z.number().min(0).max(1),
  compactionTarget: z.number().min(0).max(1),
  maxTurnsInDumbZone: z.number().int().min(1),
  maxToolErrorRate: z.number().min(0).max(1),
  expectedTurns: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
});

export type FallbackThresholds = z.infer<typeof FallbackThresholdsSchema>;

export const ProfilesConfigSchema = z.object({
  profiles: z.array(ContextWindowProfileSchema),
  fallbackThresholds: FallbackThresholdsSchema.optional(),
});

export type ProfilesConfig = z.infer<typeof ProfilesConfigSchema>;
