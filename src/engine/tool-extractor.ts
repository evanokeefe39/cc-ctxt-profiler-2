import type { TranscriptLine } from '../schemas/index.js';

export interface ToolCallStats {
  toolUseCount: number;
  toolErrorCount: number;
}

/**
 * Extract tool call statistics from a pair of assistant + user messages.
 * - Count `tool_use` blocks in assistant message content
 * - Count `tool_result` blocks with `is_error: true` in user message content
 */
export function extractToolStats(
  assistantLine: TranscriptLine,
  userResponseLine?: TranscriptLine,
): ToolCallStats {
  let toolUseCount = 0;
  let toolErrorCount = 0;

  // Count tool_use blocks in assistant message
  if (Array.isArray(assistantLine.message.content)) {
    for (const block of assistantLine.message.content) {
      if (block && typeof block === 'object' && block.type === 'tool_use') {
        toolUseCount++;
      }
    }
  }

  // Count tool_result errors in user response
  if (userResponseLine && Array.isArray(userResponseLine.message.content)) {
    for (const block of userResponseLine.message.content) {
      if (
        block &&
        typeof block === 'object' &&
        block.type === 'tool_result' &&
        block.is_error === true
      ) {
        toolErrorCount++;
      }
    }
  }

  return { toolUseCount, toolErrorCount };
}
