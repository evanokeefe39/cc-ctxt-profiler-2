import type { AgentTimeSeries, DiagnosticEvent, SessionSummary } from '../../schemas/index.js';
import { escapeHtml } from '../layout.js';

/**
 * Render the session detail wrapper with tabbed navigation.
 */
export function renderSessionDetail(
  projectKey: string,
  sessionId: string,
  summary: SessionSummary,
  agents: AgentTimeSeries[],
  events: DiagnosticEvent[],
): string {
  const shortId = sessionId.slice(0, 8);
  const health = summary.overallHealth;

  const agentOptions = agents
    .map((a) => `<option value="${escapeHtml(a.agentId)}">${escapeHtml(a.label)}</option>`)
    .join('\n');

  return `<div x-data="{ activeTab: 'agents' }">
    <!-- Session header -->
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-semibold">Session ${escapeHtml(shortId)}</h2>
        <p class="text-xs text-muted-foreground mt-0.5">
          ${escapeHtml(summary.startTime)} &mdash; ${escapeHtml(summary.endTime)}
          &middot; ${summary.agents.length} agent${summary.agents.length !== 1 ? 's' : ''}
          &middot; ${events.length} event${events.length !== 1 ? 's' : ''}
        </p>
      </div>
      <span class="text-sm font-medium health-${health} px-3 py-1 rounded-full health-bg-${health}">${health.toUpperCase()}</span>
    </div>

    <!-- Summary stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      ${summary.agents.map((a) => `<div class="rounded-lg border border-border bg-card p-3">
        <p class="text-xs text-muted-foreground truncate">${escapeHtml(a.agentId)}</p>
        <p class="text-xl font-semibold health-${a.health}">${(a.peakPct * 100).toFixed(0)}%</p>
        <p class="text-xs text-muted-foreground">${a.totalTurns} turns &middot; peak</p>
      </div>`).join('\n')}
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 border-b border-border mb-4">
      <button class="tab-btn text-sm px-4 py-2 rounded-t border-b-2 transition-colors"
        :class="activeTab === 'agents' ? 'border-blue-500 text-foreground active' : 'border-transparent text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'agents'"
        hx-get="/partials/agents/${encodeURIComponent(projectKey)}/${encodeURIComponent(sessionId)}"
        hx-target="#tab-content"
        hx-trigger="click"
        hx-swap="innerHTML">Agents</button>
      <button class="tab-btn text-sm px-4 py-2 rounded-t border-b-2 transition-colors"
        :class="activeTab === 'messages' ? 'border-blue-500 text-foreground active' : 'border-transparent text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'messages'"
        hx-get="/partials/messages/${encodeURIComponent(projectKey)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(agents[0]?.agentId ?? '')}"
        hx-target="#tab-content"
        hx-trigger="click"
        hx-swap="innerHTML">Messages</button>
      <button class="tab-btn text-sm px-4 py-2 rounded-t border-b-2 transition-colors"
        :class="activeTab === 'tools' ? 'border-blue-500 text-foreground active' : 'border-transparent text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'tools'"
        hx-get="/partials/tools/${encodeURIComponent(projectKey)}/${encodeURIComponent(sessionId)}"
        hx-target="#tab-content"
        hx-trigger="click"
        hx-swap="innerHTML">Tools</button>
      <button class="tab-btn text-sm px-4 py-2 rounded-t border-b-2 transition-colors"
        :class="activeTab === 'events' ? 'border-blue-500 text-foreground active' : 'border-transparent text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'events'"
        hx-get="/partials/events/${encodeURIComponent(projectKey)}/${encodeURIComponent(sessionId)}"
        hx-target="#tab-content"
        hx-trigger="click"
        hx-swap="innerHTML">Events <span class="ml-1 text-xs text-muted-foreground">${events.length}</span></button>
    </div>

    <!-- Tab content — agents tab loaded by default -->
    <div id="tab-content"
      hx-get="/partials/agents/${encodeURIComponent(projectKey)}/${encodeURIComponent(sessionId)}"
      hx-trigger="load"
      hx-swap="innerHTML">
      <div class="flex items-center justify-center py-12 text-muted-foreground">
        <svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
        Loading...
      </div>
    </div>
  </div>`;
}
