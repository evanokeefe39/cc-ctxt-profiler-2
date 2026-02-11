import type { DiagnosticEvent } from '../../schemas/index.js';
import { escapeHtml, formatTime } from '../layout.js';

/**
 * Render the events tab: severity filter + event feed.
 */
export function renderEventsTab(events: DiagnosticEvent[]): string {
  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const infoCt = events.filter((e) => e.severity === 'info').length;
  const warnCt = events.filter((e) => e.severity === 'warning').length;
  const critCt = events.filter((e) => e.severity === 'critical').length;

  const eventCards = sorted
    .map(
      (e) => `<div class="event-card rounded border border-border bg-muted/30 px-3 py-2 text-xs"
        data-severity="${e.severity}"
        x-show="filter === 'all' || filter === '${e.severity}'">
        <div class="flex items-center justify-between mb-0.5">
          <span class="font-medium severity-${e.severity}">${escapeHtml(e.type)}</span>
          <span class="text-muted-foreground">${formatTime(e.timestamp)}</span>
        </div>
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[10px] text-muted-foreground">${escapeHtml(e.agentId)}</span>
        </div>
        <p class="text-muted-foreground">${escapeHtml(e.message)}</p>
      </div>`,
    )
    .join('\n');

  return `<div x-data="{ filter: 'all' }" class="space-y-3">
    <!-- Severity filters -->
    <div class="flex items-center gap-2">
      <div class="flex gap-1">
        <button class="sev-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground transition-colors"
          :class="{ active: filter === 'all' }" @click="filter = 'all'">All <span class="ml-1 opacity-60">${events.length}</span></button>
        <button class="sev-btn text-xs px-3 py-1.5 rounded border border-border severity-info transition-colors"
          :class="{ active: filter === 'info' }" @click="filter = 'info'">Info <span class="ml-1 opacity-60">${infoCt}</span></button>
        <button class="sev-btn text-xs px-3 py-1.5 rounded border border-border severity-warning transition-colors"
          :class="{ active: filter === 'warning' }" @click="filter = 'warning'">Warn <span class="ml-1 opacity-60">${warnCt}</span></button>
        <button class="sev-btn text-xs px-3 py-1.5 rounded border border-border severity-critical transition-colors"
          :class="{ active: filter === 'critical' }" @click="filter = 'critical'">Crit <span class="ml-1 opacity-60">${critCt}</span></button>
      </div>
    </div>

    <!-- Event feed -->
    <div class="space-y-2 max-h-[600px] overflow-y-auto pr-1">
      ${eventCards}
      ${events.length === 0 ? `<div class="text-center py-8 text-sm text-muted-foreground">No diagnostic events.</div>` : ''}
    </div>
  </div>`;
}
