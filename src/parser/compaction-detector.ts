import type { TimeSeriesPoint, Compaction } from '../schemas/index.js';
import { COMPACTION_DROP_THRESHOLD } from '../schemas/index.js';

/**
 * Detect compaction events in a time series.
 * A compaction is detected when pct drops by more than COMPACTION_DROP_THRESHOLD
 * between consecutive points.
 */
export function detectCompactions(points: TimeSeriesPoint[]): Compaction[] {
  const compactions: Compaction[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const drop = prev.pct - curr.pct;

    if (drop > COMPACTION_DROP_THRESHOLD) {
      compactions.push({
        t: curr.t,
        before: prev.abs,
        after: curr.abs,
      });
    }
  }

  return compactions;
}
