import type { SessionListEntry } from '../parser/session-discovery.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function renderSessionRow(entry: SessionListEntry): string {
  const mtimeMs = entry.mtime.getTime();
  const shortId = entry.sessionId.slice(0, 8);
  const href = `/session/${encodeURIComponent(entry.projectKey)}/${encodeURIComponent(entry.sessionId)}`;

  return `<tr class="session-row border-b border-border hover:bg-muted/40 cursor-pointer transition-colors"
    data-mtime="${mtimeMs}" data-size="${entry.sizeBytes}" data-agents="${entry.agentCount}"
    onclick="window.location.href='${href}'">
    <td class="px-4 py-3">
      <a href="${href}" class="text-sm font-medium text-blue-400 hover:underline">${escapeHtml(shortId)}</a>
    </td>
    <td class="px-4 py-3">
      <span class="text-sm text-foreground">${escapeHtml(entry.projectName)}</span>
    </td>
    <td class="px-4 py-3 text-sm text-muted-foreground">${formatRelativeTime(entry.mtime)}</td>
    <td class="px-4 py-3 text-sm text-muted-foreground">${formatBytes(entry.sizeBytes)}</td>
    <td class="px-4 py-3 text-sm text-muted-foreground">${entry.agentCount}</td>
  </tr>`;
}

export function renderSessionListHtml(entries: SessionListEntry[]): string {
  const rows = entries.map(renderSessionRow).join('\n');
  const totalSessions = entries.length;

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Session Browser — Context Diagnostics</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'hsl(240, 3.7%, 15.9%)',
            background: 'hsl(240, 10%, 3.9%)',
            foreground: 'hsl(0, 0%, 98%)',
            card: 'hsl(240, 10%, 3.9%)',
            'card-foreground': 'hsl(0, 0%, 98%)',
            muted: 'hsl(240, 3.7%, 15.9%)',
            'muted-foreground': 'hsl(240, 5%, 64.9%)',
            accent: 'hsl(240, 3.7%, 15.9%)',
          },
        },
      },
    };
  </script>
  <style>
    body { background: hsl(240, 10%, 3.9%); }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: hsl(240, 3.7%, 25%); border-radius: 3px; }
    .filter-btn.active { background: hsl(240, 3.7%, 25%); color: hsl(0, 0%, 98%); }
  </style>
</head>
<body class="text-foreground min-h-screen">
  <header class="border-b border-border px-6 py-4">
    <div class="flex items-center justify-between max-w-[1200px] mx-auto">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Session Browser</h1>
        <p class="text-sm text-muted-foreground mt-0.5">${totalSessions} session${totalSessions !== 1 ? 's' : ''} found</p>
      </div>
    </div>
  </header>

  <div class="max-w-[1200px] mx-auto px-6 py-6">
    <!-- Controls -->
    <div class="flex items-center justify-between mb-4">
      <!-- Time filter -->
      <div class="flex gap-1" id="time-filters">
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors" data-range="86400000">24h</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors" data-range="604800000">7d</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors" data-range="2592000000">30d</button>
        <button class="filter-btn active text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors" data-range="0">All</button>
      </div>
      <!-- Sort -->
      <div class="flex gap-1" id="sort-controls">
        <button class="filter-btn active text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors" data-sort="mtime">Recent</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors" data-sort="size">Size</button>
        <button class="filter-btn text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors" data-sort="agents">Agents</button>
      </div>
    </div>

    <!-- Table -->
    <div class="rounded-lg border border-border bg-card overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-border bg-muted/30">
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Session</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Project</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Modified</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Size</th>
            <th class="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Agents</th>
          </tr>
        </thead>
        <tbody id="session-table">
          ${rows}
        </tbody>
      </table>
      <div id="empty-state" class="hidden px-4 py-12 text-center text-sm text-muted-foreground">
        No sessions match the current filter.
      </div>
    </div>
    <p id="visible-count" class="text-xs text-muted-foreground mt-2"></p>
  </div>

  <script>
    (function() {
      const table = document.getElementById('session-table');
      const rows = Array.from(table.querySelectorAll('.session-row'));
      const emptyState = document.getElementById('empty-state');
      const visibleCount = document.getElementById('visible-count');
      let activeRange = 0;
      let activeSort = 'mtime';

      function applyFilter() {
        const now = Date.now();
        let visible = 0;
        rows.forEach(row => {
          const mtime = parseInt(row.dataset.mtime, 10);
          const show = activeRange === 0 || (now - mtime) <= activeRange;
          row.style.display = show ? '' : 'none';
          if (show) visible++;
        });
        emptyState.classList.toggle('hidden', visible > 0);
        visibleCount.textContent = visible < rows.length ? visible + ' of ' + rows.length + ' shown' : '';
      }

      function applySort() {
        const sorted = [...rows].sort((a, b) => {
          if (activeSort === 'mtime') return parseInt(b.dataset.mtime, 10) - parseInt(a.dataset.mtime, 10);
          if (activeSort === 'size') return parseInt(b.dataset.size, 10) - parseInt(a.dataset.size, 10);
          return parseInt(b.dataset.agents, 10) - parseInt(a.dataset.agents, 10);
        });
        sorted.forEach(row => table.appendChild(row));
      }

      document.getElementById('time-filters').addEventListener('click', e => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        document.querySelectorAll('#time-filters .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeRange = parseInt(btn.dataset.range, 10);
        applyFilter();
      });

      document.getElementById('sort-controls').addEventListener('click', e => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        document.querySelectorAll('#sort-controls .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeSort = btn.dataset.sort;
        applySort();
        applyFilter();
      });
    })();
  </script>
</body>
</html>`;
}
