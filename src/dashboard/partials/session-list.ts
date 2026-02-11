import type { DbSessionListEntry } from '../../db/queries.js';
import { escapeHtml, formatBytes, formatRelativeTime } from '../layout.js';

/**
 * Render the session list table for a project.
 */
export function renderSessionList(
  projectKey: string,
  projectName: string,
  sessions: DbSessionListEntry[],
): string {
  const rows = sessions.map((s) => renderSessionRow(projectKey, s)).join('\n');
  const total = sessions.length;

  return `<div class="space-y-4" x-data="{ range: 0, sort: 'mtime' }">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">${escapeHtml(projectName)}</h2>
      <span class="text-sm text-muted-foreground">${total} session${total !== 1 ? 's' : ''}</span>
    </div>

    <!-- Controls -->
    <div class="flex items-center justify-between">
      <!-- Time filter -->
      <div class="flex gap-1">
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
          :class="{ active: range === 86400000 }" @click="range = 86400000">24h</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
          :class="{ active: range === 604800000 }" @click="range = 604800000">7d</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
          :class="{ active: range === 2592000000 }" @click="range = 2592000000">30d</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
          :class="{ active: range === 0 }" @click="range = 0">All</button>
      </div>
      <!-- Sort -->
      <div class="flex gap-1">
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
          :class="{ active: sort === 'mtime' }" @click="sort = 'mtime'">Recent</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
          :class="{ active: sort === 'size' }" @click="sort = 'size'">Size</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
          :class="{ active: sort === 'agents' }" @click="sort = 'agents'">Agents</button>
      </div>
    </div>

    <!-- Table -->
    <div class="rounded-lg border border-border bg-card overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-border bg-muted/30">
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Session</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Modified</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Size</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Agents</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Health</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Turns</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${total === 0 ? `<div class="px-4 py-12 text-center text-sm text-muted-foreground">No sessions found for this project.</div>` : ''}
    </div>
  </div>`;
}

function renderSessionRow(projectKey: string, entry: DbSessionListEntry): string {
  const shortId = entry.sessionId.slice(0, 8);
  const href = `/session/${encodeURIComponent(projectKey)}/${encodeURIComponent(entry.sessionId)}`;
  const mtimeMs = entry.mtime.getTime();
  const health = entry.overallHealth ?? 'unknown';

  return `<tr class="border-b border-border hover:bg-muted/40 cursor-pointer transition-colors"
    data-nav-item data-mtime="${mtimeMs}" data-size="${entry.sizeBytes}" data-agents="${entry.agentCount}"
    x-show="range === 0 || (Date.now() - ${mtimeMs}) <= range"
    hx-get="/partials/detail/${encodeURIComponent(projectKey)}/${encodeURIComponent(entry.sessionId)}"
    hx-target="#main-content"
    hx-push-url="${href}">
    <td class="px-4 py-3">
      <span class="text-sm font-medium text-blue-400">${escapeHtml(shortId)}</span>
    </td>
    <td class="px-4 py-3 text-sm text-muted-foreground">${formatRelativeTime(entry.mtime)}</td>
    <td class="px-4 py-3 text-sm text-muted-foreground">${formatBytes(entry.sizeBytes)}</td>
    <td class="px-4 py-3 text-sm text-muted-foreground">${entry.agentCount}</td>
    <td class="px-4 py-3">
      ${health !== 'unknown' ? `<span class="text-xs font-medium health-${health} px-2 py-0.5 rounded-full health-bg-${health}">${health}</span>` : '<span class="text-xs text-muted-foreground">-</span>'}
    </td>
    <td class="px-4 py-3 text-sm text-muted-foreground">${entry.totalTurns}</td>
  </tr>`;
}
