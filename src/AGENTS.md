# SOURCE KNOWLEDGE BASE

**Scope:** `src/`

## OVERVIEW
`src/` contains the application runtime (Next.js App Router), UI modules, realtime hooks, shared utilities, and the package export surface.

## STRUCTURE
```text
src/
├── app/                 # Next.js page/layout + API routes
├── components/          # board UI and config experience
├── hooks/               # realtime stream/cache integration
├── lib/                 # discovery, transforms, config/profile IO
├── test/                # test bootstrap (`setup.ts`)
├── types/               # domain contracts
└── index.ts             # publishable library exports
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main page shell | `src/app/page.tsx` | top-level filters, mute, config panel state |
| Backend API behavior | `src/app/api/` | route handlers and OpenCode integration |
| Board data + degraded UX | `src/components/KanbanBoard.tsx` | polling, stale snapshot, errors |
| Realtime event sync | `src/hooks/useOpencodeSync.ts` | SSE events + optimistic cache updates |
| Session/card transforms | `src/lib/transform.ts` | source sessions -> kanban cards |
| Library public surface | `src/index.ts` | only exported runtime API for package consumers |

## CONVENTIONS
- Keep Next.js route handlers under `src/app/api/**/route.ts`; avoid ad-hoc API helper entrypoints.
- Keep tests co-located (`*.test.ts`, `*.test.tsx`); shared test runtime setup stays in `src/test/setup.ts`.
- Keep package-facing exports centralized in `src/index.ts`.
- Keep cross-module imports on `@/` alias instead of deep relative paths when crossing feature boundaries.
- Keep profile/config persistence logic in `src/lib/profiles` and `src/lib/opencodeConfig.ts`, not in UI components.

## ANTI-PATTERNS
- Do not add new package exports outside `src/index.ts`; `build:lib` only compiles from that entry.
- Do not bypass shared transform/discovery utilities by duplicating logic in page/components.
- Do not keep extending known hotspots (`src/app/api/sessions/route.ts`, `src/components/KanbanBoard.tsx`) without extracting helpers.
- Do not move tests to a separate global test tree; this codebase relies on co-location for context.
