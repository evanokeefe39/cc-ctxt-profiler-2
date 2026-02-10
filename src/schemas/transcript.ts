import { z } from 'zod';

export const UsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().optional().default(0),
  cache_read_input_tokens: z.number().optional().default(0),
});

export type Usage = z.infer<typeof UsageSchema>;

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  model: z.string().optional(),
  content: z.array(z.any()),
  usage: UsageSchema.optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export const TranscriptLineSchema = z.object({
  sessionId: z.string(),
  uuid: z.string(),
  parentUuid: z.string().nullable().optional(),
  timestamp: z.string(),
  type: z.enum(['user', 'assistant']),
  isSidechain: z.boolean().optional().default(false),
  message: MessageSchema,
});

export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;
