import { z } from 'zod';
import { DiagnosticEventSchema } from './events.js';
import { AgentTimeSeriesSchema } from './time-series.js';

export const HealthGrade = z.enum(['healthy', 'degraded', 'unhealthy']);
export type HealthGrade = z.infer<typeof HealthGrade>;

export const InsightSchema = z.object({
  agentId: z.string(),
  category: z.string(),
  message: z.string(),
});

export type Insight = z.infer<typeof InsightSchema>;

export const SuggestionSchema = z.object({
  priority: z.number().int().min(1),
  agentId: z.string().optional(),
  message: z.string(),
  action: z.string().optional(),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;

export const AgentSummarySchema = z.object({
  agentId: z.string(),
  model: z.string(),
  health: HealthGrade,
  totalTurns: z.number().int(),
  peakPct: z.number(),
  finalPct: z.number(),
  turnsInWarning: z.number().int(),
  turnsInDumbZone: z.number().int(),
  compactions: z.number().int(),
  toolErrorRate: z.number(),
  events: z.array(DiagnosticEventSchema),
});

export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  agents: z.array(AgentSummarySchema),
  insights: z.array(InsightSchema),
  suggestions: z.array(SuggestionSchema),
  overallHealth: HealthGrade,
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;
