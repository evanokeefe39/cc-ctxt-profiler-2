import { readFileSync } from 'node:fs';
import { TranscriptLineSchema, type TranscriptLine } from '../schemas/index.js';

export interface ReadResult {
  lines: TranscriptLine[];
  bytesRead: number;
  /** Incomplete trailing line to buffer for next incremental read */
  remainder: string;
}

/**
 * Read and parse an entire JSONL file.
 */
export function readJsonlFile(filePath: string): TranscriptLine[] {
  const content = readFileSync(filePath, 'utf-8');
  return parseJsonlContent(content);
}

/**
 * Read JSONL file incrementally from a byte offset.
 * Returns parsed lines and the new byte offset for next read.
 */
export function readJsonlIncremental(
  filePath: string,
  fromByte: number,
  previousRemainder: string = '',
): ReadResult {
  const buf = readFileSync(filePath);
  const newBytes = buf.subarray(fromByte);
  const newContent = previousRemainder + newBytes.toString('utf-8');

  const rawLines = newContent.split('\n');
  // Last element may be incomplete — buffer it
  const remainder = rawLines.pop() ?? '';

  const lines: TranscriptLine[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = tryParseJsonlLine(trimmed);
    if (parsed) lines.push(parsed);
  }

  return {
    lines,
    bytesRead: fromByte + newBytes.length,
    remainder,
  };
}

/**
 * Parse JSONL content string into validated transcript lines.
 */
export function parseJsonlContent(content: string): TranscriptLine[] {
  const rawLines = content.split('\n');
  const lines: TranscriptLine[] = [];

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = tryParseJsonlLine(trimmed);
    if (parsed) lines.push(parsed);
  }

  return lines;
}

function tryParseJsonlLine(line: string): TranscriptLine | null {
  try {
    const json = JSON.parse(line);
    const result = TranscriptLineSchema.safeParse(json);
    if (result.success) return result.data;
    return null;
  } catch {
    return null;
  }
}
