import { z } from 'zod';

export const TimeSeriesPointSchema = z.object({
  /** ISO-8601 timestamp */
  t: z.string(),
  /** Absolute token count */
  abs: z.number(),
  /** Percentage of context limit (0-1) */
  pct: z.number(),
});

export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

export const CompactionSchema = z.object({
  /** ISO-8601 timestamp */
  t: z.string(),
  /** Token count before compaction */
  before: z.number(),
  /** Token count after compaction */
  after: z.number(),
});

export type Compaction = z.infer<typeof CompactionSchema>;

export const AgentTimeSeriesSchema = z.object({
  agentId: z.string(),
  model: z.string(),
  label: z.string(),
  limit: z.number(),
  threshold: z.number(),
  warningThreshold: z.number(),
  points: z.array(TimeSeriesPointSchema),
  compactions: z.array(CompactionSchema),
});

export type AgentTimeSeries = z.infer<typeof AgentTimeSeriesSchema>;
