# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-18 17:32:38 CST
**Commit:** 790ac70
**Branch:** C3-317-vibepluse-profile

## OVERVIEW
VibePulse is a Next.js App Router dashboard for monitoring OpenCode sessions in real time (SSE + polling), with built-in OpenCode profile/config management.
This repository is dual-purpose: web app runtime, publishable library surface (`src/index.ts`), and npm CLI launcher (`bin/vibepulse.js`).

## STRUCTURE
```text
VibePulse/
├── src/app/                          # Next.js app shell and API routes
│   └── api/                          # OpenCode sessions/config/profiles/events handlers
├── src/components/                   # board UI and settings/config panels
│   └── opencode-config/              # agent/category/profile editing flows
├── src/hooks/                        # SSE stream sync + cache orchestration
├── src/lib/                          # discovery/config IO/transform utilities
├── src/types/                        # app-level and config-level TS types
├── bin/vibepulse.js                  # CLI entry: standalone server -> next fallback
├── docs/session-status-detection.md  # status stabilization design details
└── .github/workflows/                # CI and release automation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Session aggregation logic | `src/app/api/sessions/route.ts` | largest backend hotspot; status stabilization and child resolution |
| OpenCode event streaming | `src/app/api/opencode-events/route.ts` | SSE fan-in across discovered ports |
| Config sanitization/update | `src/app/api/opencode-config/route.ts` | filters/validates allowed agent/category/vibepulse fields |
| Profile persistence and defaults | `src/lib/profiles/storage.ts` | built-in profiles + index/config file IO |
| Profile import/export schema | `src/lib/profiles/share.ts` | profile file validation + transfer payloads |
| Board state and degraded mode | `src/components/KanbanBoard.tsx` | polling + stale snapshot fallback + audio triggers |
| SSE client/cache sync | `src/hooks/useOpencodeSync.ts` | event handling, retries, optimistic cache patches |
| CLI boot path | `bin/vibepulse.js` | starts standalone output or falls back to `next start` |

## CODE MAP
LSP was unavailable in this environment (`typescript-language-server` missing), so this map uses static centrality hotspots.

| Module | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Sessions API hub | route handler | `src/app/api/sessions/route.ts` | high | canonical backend session state assembler |
| Board orchestration | client component | `src/components/KanbanBoard.tsx` | high | transforms/enriches sessions into kanban UI |
| SSE sync engine | hook | `src/hooks/useOpencodeSync.ts` | high | live updates into TanStack Query cache |
| Config API gatekeeper | route handler | `src/app/api/opencode-config/route.ts` | medium | validates and strips unsafe config fields |

## CONVENTIONS
- Runtime port is pinned to `3456` for `dev` and `start` scripts.
- Tests are co-located with source (`*.test.ts`, `*.test.tsx`, one `*.test.js` interop case).
- Path alias `@/*` maps to `src/*` in both TypeScript and Vitest.
- Library build is separate from app build: `tsup` + `tsconfig.lib.json`, excluding tests from dist output.
- API endpoints follow Next.js `route.ts` handlers; action endpoints nest under resource paths (for example `[id]/archive`).

## ANTI-PATTERNS (THIS PROJECT)
- Do not send secret-like keys (`api*`, `*token*`, `*secret*`, `*password*`, etc.) to `/api/opencode-config`; requests are rejected.
- Do not add unsupported agent/category fields in config update payloads; API uses explicit allowlists.
- Do not reintroduce deprecated built-in profile IDs (`coding`, `writing`, `debug`, `minimal`); cleanup exists in storage bootstrap.
- Do not create profile IDs outside `[a-zA-Z0-9_-]`; import/create endpoints enforce this.
- Do not hardcode a single OpenCode port in new logic; discovery is multi-source (`lsof` + process args + known port memory).

## UNIQUE STYLES
- Session status uses sticky stabilization windows to reduce flicker while preserving busy/retry semantics.
- UI merges stale local snapshot data during degraded backend periods to keep board context visible.
- SSE stream handling rotates/reconnects with backoff and keeps cache-level optimistic session updates.
- Profile import flow writes index then config with rollback on config-write failure.

## COMMANDS
```bash
npm run dev
npm run lint
npm run test
npm run test:run
npm run build
npm run build:lib
```

## SCOPED GUIDES
- `src/AGENTS.md`
- `src/app/api/AGENTS.md`
- `src/components/AGENTS.md`

## NOTES
- CI pipeline: lint -> test:run -> build on pushes/PRs to `main` and `master`.
- Release pipeline is tag-driven (`v*.*.*` and prerelease variants) with npm provenance publish.
