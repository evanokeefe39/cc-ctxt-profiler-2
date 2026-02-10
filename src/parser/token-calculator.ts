import type { Usage } from '../schemas/index.js';

/**
 * Compute total used tokens from a usage object.
 * Formula: input_tokens + cache_read_input_tokens + cache_creation_input_tokens
 *
 * Note: output_tokens are not included as they don't consume context window space
 * in the same way — they represent the model's output for that turn.
 */
export function computeUsedTokens(usage: Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}
