import type { AgentTimeSeries } from '../../schemas/index.js';
import type { DbMessageEntry } from '../../db/queries.js';
import { escapeHtml, formatTime } from '../layout.js';

/**
 * Render the messages tab: agent selector + message table.
 */
export function renderMessagesTab(
  messages: DbMessageEntry[],
  agents: AgentTimeSeries[],
  projectKey: string,
  sessionId: string,
  currentAgentId: string,
): string {
  const agentOptions = agents
    .map((a) => {
      const selected = a.agentId === currentAgentId ? ' selected' : '';
      return `<option value="${escapeHtml(a.agentId)}"${selected}>${escapeHtml(a.label)}</option>`;
    })
    .join('\n');

  const rows = messages.map((m) => renderMessageRow(m)).join('\n');

  return `<div class="space-y-4">
    <!-- Agent selector -->
    <div class="flex items-center gap-3">
      <label class="text-sm text-muted-foreground">Agent:</label>
      <select class="bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground"
        hx-get=""
        hx-target="#tab-content"
        hx-swap="innerHTML"
        x-ref="agentSelect"
        @change="
          var agentId = $refs.agentSelect.value;
          htmx.ajax('GET', '/partials/messages/${encodeURIComponent(projectKey)}/${encodeURIComponent(sessionId)}/' + encodeURIComponent(agentId), {target: '#tab-content', swap: 'innerHTML'});
        ">
        ${agentOptions}
      </select>
      <span class="text-xs text-muted-foreground">${messages.length} message${messages.length !== 1 ? 's' : ''}</span>
    </div>

    <!-- Messages table -->
    <div class="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border bg-muted/30">
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Type</th>
            <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Input</th>
            <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Output</th>
            <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Total</th>
            <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Context %</th>
            <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Cache</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${messages.length === 0 ? `<div class="px-4 py-8 text-center text-sm text-muted-foreground">No messages for this agent.</div>` : ''}
    </div>
  </div>`;
}

function renderMessageRow(msg: DbMessageEntry): string {
  const isUser = msg.type === 'user';
  const rowBg = isUser ? 'bg-blue-500/5' : '';
  const typeBadge = isUser
    ? '<span class="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px]">user</span>'
    : '<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px]">assistant</span>';

  const pctStr = msg.pct != null ? `${(msg.pct * 100).toFixed(1)}%` : '-';
  const pctColor = msg.pct != null
    ? msg.pct > 0.8 ? 'text-red-400' : msg.pct > 0.6 ? 'text-yellow-400' : 'text-foreground'
    : 'text-muted-foreground';

  const cacheStr = formatCacheTokens(msg.cacheCreationTokens, msg.cacheReadTokens);

  return `<tr class="border-b border-border/50 ${rowBg}">
    <td class="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">${formatTime(msg.timestamp)}</td>
    <td class="px-3 py-2">${typeBadge}</td>
    <td class="px-3 py-2 text-right text-xs tabular-nums">${msg.inputTokens != null ? msg.inputTokens.toLocaleString() : '-'}</td>
    <td class="px-3 py-2 text-right text-xs tabular-nums">${msg.outputTokens != null ? msg.outputTokens.toLocaleString() : '-'}</td>
    <td class="px-3 py-2 text-right text-xs tabular-nums font-medium">${msg.absTokens != null ? msg.absTokens.toLocaleString() : '-'}</td>
    <td class="px-3 py-2 text-right text-xs tabular-nums ${pctColor}">${pctStr}</td>
    <td class="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">${cacheStr}</td>
  </tr>`;
}

function formatCacheTokens(creation: number | null, read: number | null): string {
  const parts: string[] = [];
  if (creation && creation > 0) parts.push(`+${(creation / 1000).toFixed(1)}k`);
  if (read && read > 0) parts.push(`${(read / 1000).toFixed(1)}k hit`);
  return parts.length > 0 ? parts.join(' / ') : '-';
}
