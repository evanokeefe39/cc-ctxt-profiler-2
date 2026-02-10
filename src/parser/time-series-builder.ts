import type { TranscriptLine, TimeSeriesPoint, AgentTimeSeries } from '../schemas/index.js';
import { MODEL_LIMITS, DEFAULT_CONTEXT_LIMIT, FALLBACK_THRESHOLDS } from '../schemas/index.js';
import { computeUsedTokens } from './token-calculator.js';
import { detectCompactions } from './compaction-detector.js';

/**
 * Build an AgentTimeSeries from a set of transcript lines belonging to one agent.
 */
export function buildAgentTimeSeries(
  agentId: string,
  label: string,
  lines: TranscriptLine[],
): AgentTimeSeries {
  // Filter to assistant messages with usage data
  const assistantLines = lines.filter(
    (l) => l.type === 'assistant' && l.message.role === 'assistant' && l.message.usage,
  );

  // Deduplicate by uuid — keep the entry with highest output_tokens
  const deduped = deduplicateByUuid(assistantLines);

  // Sort by timestamp
  deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Resolve model and context limit
  const model = resolveModel(deduped);
  const limit = MODEL_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;

  // Build points
  const points: TimeSeriesPoint[] = deduped.map((line) => {
    const abs = computeUsedTokens(line.message.usage!);
    return {
      t: line.timestamp,
      abs,
      pct: abs / limit,
    };
  });

  // Detect compactions
  const compactions = detectCompactions(points);

  return {
    agentId,
    model,
    label,
    limit,
    threshold: FALLBACK_THRESHOLDS.dumbZoneThreshold,
    warningThreshold: FALLBACK_THRESHOLDS.warningThreshold,
    points,
    compactions,
  };
}

/**
 * Deduplicate transcript lines by uuid, keeping the entry with highest output_tokens.
 */
function deduplicateByUuid(lines: TranscriptLine[]): TranscriptLine[] {
  const byUuid = new Map<string, TranscriptLine>();

  for (const line of lines) {
    const existing = byUuid.get(line.uuid);
    if (!existing) {
      byUuid.set(line.uuid, line);
    } else {
      const existingOutput = existing.message.usage?.output_tokens ?? 0;
      const currentOutput = line.message.usage?.output_tokens ?? 0;
      if (currentOutput > existingOutput) {
        byUuid.set(line.uuid, line);
      }
    }
  }

  return Array.from(byUuid.values());
}

/**
 * Resolve the model name from assistant lines.
 */
function resolveModel(lines: TranscriptLine[]): string {
  for (const line of lines) {
    if (line.message.model) return line.message.model;
  }
  return 'unknown';
}
