# context-diag

Claude Code context window diagnostics — lightweight monitoring, profile-driven thresholds, diagnostic events, session feedback.

## Spec

Full specification: https://www.notion.so/3036b8a9705281a48c14dde643faf4ff

## Project Setup

```bash
npm install       # install dependencies
npm run build     # tsup bundles to dist/
npm test          # vitest — 86+ tests across 6 suites
```

## Architecture

- **ESM TypeScript** project, bundled with `tsup`, tested with `vitest`
- `tsup` flattens output — binary is at `dist/context-diag.js` (not `dist/bin/`)
- Dashboard uses **Tailwind CSS via CDN** (shadcn-inspired dark theme) — server-rendered HTML, not React

### Module Map

| Module | Purpose |
|--------|---------|
| `src/schemas/` | Zod schemas: transcript, time-series, profiles, events, summary |
| `src/parser/` | JSONL reader (incremental byte-offset), session discovery, time-series builder |
| `src/profiles/` | Loader, matcher (exact ID then model fallback), validator |
| `src/engine/` | `EventEvaluator` — stateful per-agent, 12 diagnostic event types |
| `src/summary/` | Health classifier, insight generator, suggestion generator |
| `src/dashboard/` | SVG renderer, HTML templates, SSE manager, HTTP servers (live + browse) |
| `src/monitor/` | Chokidar file watcher, parser, evaluator, SSE broadcast orchestration |
| `src/cli/` | Commander commands: `watch`, `analyze`, `browse`, `profile validate` |

### CLI Commands

```bash
context-diag watch --session <dir> [--profiles <file>] [--port 8411]
context-diag analyze --session <dir> [--profiles <file>] [--output <file>]
context-diag browse [--projects-dir <dir>] [--port 8411] [--no-browser]
context-diag profile validate --profiles <file>
```

### Key Patterns

- **Parse on demand** — `browse` does only `readdirSync`/`statSync` for the session list; full JSONL parsing runs only when a session detail page is opened
- **Filesystem-based path decoding** — `decodeProjectName()` walks the real filesystem to resolve encoded project directory names, handling hyphens in folder names correctly
- **Stateful evaluation** — `EventEvaluator` is instantiated per agent and tracks state across turns (dumbzone duration, tool errors, etc.)
- **Incremental parsing** — `readJsonlIncremental()` supports byte-offset reads for live file tailing

## Testing

- Fixtures live in `src/parser/__tests__/fixtures/`
- All test files co-located with source under `__tests__/` directories

## Deferred Scope

- S18: Guided profile creation CLI (`context-diag profile create`)
- S19: Profile suggestion from observed data (`context-diag profile suggest`)
