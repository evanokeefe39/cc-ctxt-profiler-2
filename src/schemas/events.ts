import { z } from 'zod';

export const DiagnosticEventType = z.enum([
  'agent_started',
  'agent_completed',
  'unmatched_agent',
  'warning_threshold_crossed',
  'dumbzone_entered',
  'dumbzone_lingering',
  'compaction_detected',
  'compaction_insufficient',
  'scope_creep',
  'tool_error_spike',
  'budget_overrun',
  'context_limit_approaching',
]);

export type DiagnosticEventType = z.infer<typeof DiagnosticEventType>;

export const Severity = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof Severity>;

export const DiagnosticEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  agentId: z.string(),
  profileId: z.string().optional(),
  severity: Severity,
  type: DiagnosticEventType,
  message: z.string(),
  data: z.record(z.any()).optional(),
});

export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>;
