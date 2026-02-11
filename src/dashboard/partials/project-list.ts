import type { DbProjectListEntry } from '../../db/queries.js';
import { escapeHtml, formatRelativeTime } from '../layout.js';

/**
 * Render the project list grid with health doughnut charts.
 */
export function renderProjectList(projects: DbProjectListEntry[]): string {
  if (projects.length === 0) {
    return `<div class="text-center py-16 text-muted-foreground">
      <p class="text-lg mb-2">No projects found</p>
      <p class="text-sm">Run <code class="bg-muted px-1.5 py-0.5 rounded">context-diag browse</code> from a directory containing Claude Code sessions.</p>
    </div>`;
  }

  const cards = projects.map((p) => renderProjectCard(p)).join('\n');

  return `<div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">Projects</h2>
      <span class="text-sm text-muted-foreground">${projects.length} project${projects.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${cards}
    </div>
  </div>`;
}

function renderProjectCard(project: DbProjectListEntry): string {
  const href = `/project/${encodeURIComponent(project.projectKey)}`;
  const total = project.healthyCount + project.degradedCount + project.unhealthyCount;
  const canvasId = `health-chart-${escapeHtml(project.projectKey).replace(/[^a-zA-Z0-9]/g, '_')}`;

  return `<a href="${href}"
    hx-get="/partials/sessions/${encodeURIComponent(project.projectKey)}"
    hx-target="#main-content"
    hx-push-url="${href}"
    data-nav-item
    class="block rounded-lg border border-border bg-card p-4 hover:border-muted-foreground/30 transition-colors cursor-pointer">
    <div class="flex items-start justify-between mb-3">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium truncate">${escapeHtml(project.projectName)}</h3>
        <p class="text-xs text-muted-foreground mt-0.5">${formatRelativeTime(project.lastActivity)}</p>
      </div>
      ${total > 0 ? `<div class="w-10 h-10 flex-shrink-0 ml-3">
        <canvas id="${canvasId}" width="40" height="40"></canvas>
      </div>` : ''}
    </div>
    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded bg-muted/40 px-2 py-1.5">
        <p class="text-lg font-semibold">${project.sessionCount}</p>
        <p class="text-[10px] text-muted-foreground">sessions</p>
      </div>
      <div class="rounded bg-muted/40 px-2 py-1.5">
        <p class="text-lg font-semibold">${project.totalTurns}</p>
        <p class="text-[10px] text-muted-foreground">turns</p>
      </div>
      <div class="rounded bg-muted/40 px-2 py-1.5">
        <div class="flex justify-center gap-1 text-xs font-medium">
          ${project.healthyCount > 0 ? `<span class="health-healthy">${project.healthyCount}</span>` : ''}
          ${project.degradedCount > 0 ? `<span class="health-degraded">${project.degradedCount}</span>` : ''}
          ${project.unhealthyCount > 0 ? `<span class="health-unhealthy">${project.unhealthyCount}</span>` : ''}
          ${total === 0 ? '<span class="text-muted-foreground">-</span>' : ''}
        </div>
        <p class="text-[10px] text-muted-foreground">health</p>
      </div>
    </div>
    ${total > 0 ? `<script>
      (function() {
        var el = document.getElementById('${canvasId}');
        if (!el || !window.Chart) return;
        new Chart(el, {
          type: 'doughnut',
          data: {
            datasets: [{
              data: [${project.healthyCount}, ${project.degradedCount}, ${project.unhealthyCount}],
              backgroundColor: ['rgba(34,197,94,0.7)', 'rgba(245,158,11,0.7)', 'rgba(239,68,68,0.7)'],
              borderWidth: 0
            }]
          },
          options: {
            cutout: '60%',
            responsive: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: false
          }
        });
      })();
    </script>` : ''}
  </a>`;
}
