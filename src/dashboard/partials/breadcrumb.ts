import { escapeHtml } from '../layout.js';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Render breadcrumb navigation with htmx links.
 */
export function renderBreadcrumb(items: BreadcrumbItem[]): string {
  return items
    .map((item, i) => {
      const isLast = i === items.length - 1;
      const separator = i > 0
        ? '<span class="mx-2 text-muted-foreground/50">/</span>'
        : '';
      if (isLast || !item.href) {
        return `${separator}<span class="text-foreground">${escapeHtml(item.label)}</span>`;
      }
      return `${separator}<a href="${escapeHtml(item.href)}"
        hx-get="/partials${item.href === '/' ? '/projects' : '/sessions/' + encodeURIComponent(item.label)}"
        hx-target="#main-content"
        hx-push-url="${escapeHtml(item.href)}"
        class="hover:text-foreground transition-colors">${escapeHtml(item.label)}</a>`;
    })
    .join('');
}
