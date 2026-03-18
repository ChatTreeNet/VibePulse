# COMPONENTS KNOWLEDGE BASE

**Scope:** `src/components/`

## OVERVIEW
`src/components/` contains the kanban board experience, shared UI primitives, and the OpenCode configuration interface (agents/categories/profiles).

## STRUCTURE
```text
src/components/
├── KanbanBoard.tsx                 # board orchestration + fetch/degraded state
├── ProjectCard.tsx                 # per-project group renderer
├── SessionCard.tsx                 # session card presentation
├── SessionList.tsx                 # list-style view support
├── opencode-config/                # full config UX
│   ├── categories/                 # category form/list/manager
│   └── profiles/                   # profile editor/list/manager/card
└── ui/                             # small reusable primitives
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Board fetch + fallback behavior | `src/components/KanbanBoard.tsx` | query polling, stale snapshot merge, retry UX |
| Project grouping + card actions | `src/components/ProjectCard.tsx` | grouped rendering and per-project controls |
| Config panel composition | `src/components/opencode-config/ConfigPanel.tsx`, `src/components/opencode-config/FullscreenConfigPanel.tsx` | tabs + panel orchestration |
| Agent model editing | `src/components/opencode-config/AgentConfigForm.tsx` | model/variant/temp/top_p editing flow |
| Category workflow | `src/components/opencode-config/categories/*` | category list + editor rules |
| Profile workflow | `src/components/opencode-config/profiles/*` | CRUD, apply/import/export surface |

## CONVENTIONS
- Board-level data fetching lives in `KanbanBoard.tsx` and is backed by TanStack Query caches.
- Config subfeatures are split by domain (`categories/`, `profiles/`) with manager/list/editor-style components.
- UI tests are co-located with components (`*.test.tsx`).
- Session display transforms are delegated to `src/lib/transform.ts` rather than duplicated in child components.
- Config mutations rely on API endpoints plus query invalidation instead of local-only state divergence.

## ANTI-PATTERNS
- Do not bypass `KanbanBoard` degraded-mode snapshot logic when touching session-fetch UX.
- Do not duplicate waiting/status merge logic from realtime hooks inside multiple card components.
- Do not inline heavy business validation into presentational components; keep validation in API/lib layers.
- Do not expand `opencode-config` with one-off files at root when feature folders (`categories`, `profiles`) already fit.
