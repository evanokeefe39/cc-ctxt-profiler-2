export interface LayoutOptions {
  title: string;
  breadcrumb: string;
  content: string;
  scripts?: string;
  sseEndpoint?: string;
}

/**
 * Render a full HTML page shell with shared head, nav, and main content area.
 */
export function renderLayout(options: LayoutOptions): string {
  const { title, breadcrumb, content, scripts = '', sseEndpoint } = options;

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script defer src="https://unpkg.com/alpinejs@3.14.8/dist/cdn.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
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
            destructive: 'hsl(0, 62.8%, 30.6%)',
          },
        },
      },
    };
  </script>
  <style>
    body { background: hsl(240, 10%, 3.9%); }
    .severity-info { color: #3b82f6; }
    .severity-warning { color: #f59e0b; }
    .severity-critical { color: #ef4444; }
    .health-healthy { color: #22c55e; }
    .health-degraded { color: #f59e0b; }
    .health-unhealthy { color: #ef4444; }
    .health-bg-healthy { background: rgba(34,197,94,0.15); }
    .health-bg-degraded { background: rgba(245,158,11,0.15); }
    .health-bg-unhealthy { background: rgba(239,68,68,0.15); }
    .sev-btn.active, .filter-btn.active, .tab-btn.active {
      background: hsl(240, 3.7%, 25%);
      color: hsl(0, 0%, 98%);
    }
    .event-card { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: hsl(240, 3.7%, 25%); border-radius: 3px; }
    [x-cloak] { display: none !important; }
    .htmx-indicator { opacity: 0; transition: opacity 200ms ease-in; }
    .htmx-request .htmx-indicator { opacity: 1; }
    .htmx-request.htmx-indicator { opacity: 1; }
  </style>
</head>
<body class="text-foreground min-h-screen" x-data="keyboardNav()">
  <!-- Nav bar -->
  <header class="border-b border-border px-6 py-3">
    <div class="flex items-center justify-between max-w-[1600px] mx-auto">
      <div class="flex items-center gap-4">
        <a href="/" hx-get="/partials/projects" hx-target="#main-content" hx-push-url="/"
           class="text-sm font-semibold tracking-tight hover:text-foreground/80">context-diag</a>
        <nav class="flex items-center text-sm text-muted-foreground">
          ${breadcrumb}
        </nav>
      </div>
      ${sseEndpoint ? `<span id="connection-status" class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">connecting...</span>` : ''}
    </div>
  </header>

  <!-- Main content -->
  <main id="main-content" class="max-w-[1600px] mx-auto px-6 py-6">
    ${content}
  </main>

  <!-- Alpine.js keyboard nav -->
  <script>
    function keyboardNav() {
      return {
        selectedIndex: -1,
        getItems() {
          return Array.from(document.querySelectorAll('[data-nav-item]'));
        },
        init() {
          document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            const items = this.getItems();
            if (!items.length) return;
            if (e.key === 'j') {
              e.preventDefault();
              this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
              items[this.selectedIndex]?.classList.add('ring-1', 'ring-blue-500/50');
              items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
              items.forEach((el, i) => { if (i !== this.selectedIndex) el.classList.remove('ring-1', 'ring-blue-500/50'); });
            } else if (e.key === 'k') {
              e.preventDefault();
              this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
              items[this.selectedIndex]?.classList.add('ring-1', 'ring-blue-500/50');
              items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
              items.forEach((el, i) => { if (i !== this.selectedIndex) el.classList.remove('ring-1', 'ring-blue-500/50'); });
            } else if (e.key === 'Enter' && this.selectedIndex >= 0) {
              const item = items[this.selectedIndex];
              const link = item?.querySelector('a[href]') ?? item?.closest('a[href]');
              if (link) {
                e.preventDefault();
                link.click();
              }
            } else if (e.key === 'Escape') {
              this.selectedIndex = -1;
              items.forEach(el => el.classList.remove('ring-1', 'ring-blue-500/50'));
            }
          });
        }
      };
    }

    // Reset keyboard nav index after htmx swaps
    document.addEventListener('htmx:afterSwap', () => {
      const body = document.querySelector('[x-data]');
      if (body && body.__x) {
        body.__x.$data.selectedIndex = -1;
      }
    });
  </script>

  ${scripts}
</body>
</html>`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(str: string): string {
  return str.replace(/[^a-zA-Z0-9-_]/g, '_');
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(date: Date): string {
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
