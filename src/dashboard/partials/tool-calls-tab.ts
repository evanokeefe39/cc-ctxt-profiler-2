import type { DbToolCallEntry } from '../../db/queries.js';
import { escapeHtml, formatTime } from '../layout.js';

export interface ToolStats {
  totalCalls: number;
  errorCount: number;
  errorRate: number;
  byTool: Map<string, { count: number; errors: number }>;
}

/**
 * Compute aggregate tool stats from entries.
 */
export function computeToolStats(toolCalls: DbToolCallEntry[]): ToolStats {
  const byTool = new Map<string, { count: number; errors: number }>();
  let errorCount = 0;

  for (const tc of toolCalls) {
    const name = tc.toolName ?? 'unknown';
    const existing = byTool.get(name) ?? { count: 0, errors: 0 };
    existing.count++;
    if (tc.isError) {
      existing.errors++;
      errorCount++;
    }
    byTool.set(name, existing);
  }

  return {
    totalCalls: toolCalls.length,
    errorCount,
    errorRate: toolCalls.length > 0 ? errorCount / toolCalls.length : 0,
    byTool,
  };
}

/**
 * Render the tool calls tab: summary stats + tool call table.
 */
export function renderToolCallsTab(
  toolCalls: DbToolCallEntry[],
  stats: ToolStats,
): string {
  // Summary cards
  const summaryCards = `<div class="grid grid-cols-3 gap-3 mb-4">
    <div class="rounded-lg border border-border bg-card p-3 text-center">
      <p class="text-xl font-semibold">${stats.totalCalls}</p>
      <p class="text-xs text-muted-foreground">total calls</p>
    </div>
    <div class="rounded-lg border border-border bg-card p-3 text-center">
      <p class="text-xl font-semibold ${stats.errorCount > 0 ? 'text-red-400' : ''}">${stats.errorCount}</p>
      <p class="text-xs text-muted-foreground">errors</p>
    </div>
    <div class="rounded-lg border border-border bg-card p-3 text-center">
      <p class="text-xl font-semibold ${stats.errorRate > 0.1 ? 'text-red-400' : stats.errorRate > 0 ? 'text-yellow-400' : ''}">${(stats.errorRate * 100).toFixed(1)}%</p>
      <p class="text-xs text-muted-foreground">error rate</p>
    </div>
  </div>`;

  // Tool breakdown
  const sortedTools = [...stats.byTool.entries()].sort((a, b) => b[1].count - a[1].count);
  const toolBreakdown = sortedTools.length > 0 ? `<div class="mb-4">
    <h3 class="text-sm font-medium mb-2">By Tool</h3>
    <div class="flex flex-wrap gap-2">
      ${sortedTools.map(([name, s]) => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border text-xs">
        <span class="font-medium">${escapeHtml(name)}</span>
        <span class="text-muted-foreground">${s.count}</span>
        ${s.errors > 0 ? `<span class="text-red-400">${s.errors} err</span>` : ''}
      </span>`).join('\n')}
    </div>
  </div>` : '';

  // Tool call table
  const rows = toolCalls.map((tc) => {
    const errClass = tc.isError ? 'bg-red-500/10' : '';
    return `<tr class="border-b border-border/50 ${errClass}">
      <td class="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">${formatTime(tc.timestamp)}</td>
      <td class="px-3 py-2 text-xs">${escapeHtml(tc.agentId)}</td>
      <td class="px-3 py-2 text-xs font-medium">${escapeHtml(tc.toolName ?? 'unknown')}</td>
      <td class="px-3 py-2 text-xs">
        ${tc.isError ? '<span class="text-red-400">error</span>' : '<span class="text-emerald-400">ok</span>'}
      </td>
    </tr>`;
  }).join('\n');

  return `<div class="space-y-4">
    ${summaryCards}
    ${toolBreakdown}
    <div class="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border bg-muted/30">
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Agent</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Tool</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${toolCalls.length === 0 ? `<div class="px-4 py-8 text-center text-sm text-muted-foreground">No tool calls recorded.</div>` : ''}
    </div>
  </div>`;
}
