# context-diag

Claude Code context window diagnostics — lightweight monitoring, profile-driven thresholds, diagnostic events, session feedback.

## Spec

Full specification: https://www.notion.so/3036b8a9705281a48c14dde643faf4ff

## Project Setup

```bash
bun install       # install dependencies
bun run build     # tsup bundles to dist/
bun test          # bun:test — 114+ tests across 8 suites
```

## Architecture

- **ESM TypeScript** project, bundled with `tsup`, tested with `bun:test`
- **Runtime: Bun** — `bun-types` for type definitions
- **HTTP: Hono** framework — `Bun.serve()` with `app.fetch` handler
- **SQLite: bun:sqlite** — `~/.context-diag/index.db`, WAL mode
- `tsup` flattens output — binary is at `dist/context-diag.js` (not `dist/bin/`)
- `tsup` config: `external: ['bun:sqlite']` required for bundling
- Dashboard uses **Tailwind CSS via CDN** (shadcn-inspired dark theme) — server-rendered HTML with htmx + Alpine.js, not React

### Module Map

| Module | Purpose |
|--------|---------|
| `src/schemas/` | Zod schemas: transcript, time-series, profiles, events, summary |
| `src/parser/` | JSONL reader (incremental byte-offset), session discovery, time-series builder |
| `src/profiles/` | Loader, matcher (exact ID → model fallback → per-model default), validator |
| `src/engine/` | `EventEvaluator` — stateful per-agent, 12 diagnostic event types |
| `src/summary/` | Health classifier, insight generator, suggestion generator |
| `src/dashboard/` | SVG renderer, DAG layout/renderer, shared layout, htmx partials, SSE manager, Hono servers (live + browse) |
| `src/dashboard/partials/` | 8 htmx partial templates: project-list, session-list, session-detail, messages-tab, tool-calls-tab, agents-tab, events-tab, breadcrumb |
| `src/db/` | SQLite schema (7 tables), database (open/create), ingest (JSONL→SQLite), queries (read-only) |
| `src/monitor/` | chokidar (discovery) + fs.watch (tailing, 200ms debounce) → parser → evaluator → SSE broadcast + SQLite dual-write |
| `src/cli/` | Commander commands: `watch`, `analyze`, `browse`, `profile validate` |

### CLI Commands

```bash
context-diag watch --session <dir> [--profiles <file>] [--port 8411]
context-diag analyze --session <dir> [--profiles <file>] [--output <file>]
context-diag browse [--projects-dir <dir>] [--port 8411] [--no-browser]
context-diag profile validate --profiles <file>
```

### Key Patterns

- **SQLite-backed browsing** — `browse` ingests JSONL into SQLite on startup, then queries the DB for all routes; events computed at query time with fresh profiles
- **Dual-write monitoring** — `watch` writes events to both SQLite (persistence) and SSE (live broadcast)
- **Filesystem-based path decoding** — `decodeProjectName()` walks the real filesystem to resolve encoded project directory names, handling hyphens in folder names correctly
- **Stateful evaluation** — `EventEvaluator` is instantiated per agent and tracks state across turns (dumbzone duration, tool errors, etc.)
- **Incremental parsing** — `readJsonlIncremental()` supports byte-offset reads for live file tailing; chokidar for discovery, fs.watch for per-file tailing
- **DAG visualization** — Agent spawn relationships rendered as SVG with shared x-axis (wall-clock time) and spawn connectors
- **Message deduplication** — by `(project_key, session_id, agent_id, uuid)`, keeps highest `output_tokens`

### DB Design

- 7 tables: projects, sessions, agents, messages, tool_calls, diagnostic_events, plus schema versioning
- `:memory:` for tests, `~/.context-diag/index.db` for production
- Browse server computes events at query time (fresh profiles), not stored from ingest
- Monitor dual-writes events to `diagnostic_events` table for persistence

## Testing

- 114+ tests across 8 test files, all passing
- Fixtures live in `src/parser/__tests__/fixtures/`
- All test files co-located with source under `__tests__/` directories

## Deferred Scope

- S18: Guided profile creation CLI (`context-diag profile create`)
- S19: Profile suggestion from observed data (`context-diag profile suggest`)
