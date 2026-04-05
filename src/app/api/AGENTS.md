# API KNOWLEDGE BASE

**Scope:** `src/app/api/`

## OVERVIEW
`src/app/api/` hosts Next.js route handlers that discover OpenCode instances, aggregate session state, stream events, and manage Oh My OpenAgent config/profile data.

## STRUCTURE
```text
src/app/api/
├── sessions/                     # session list/status aggregation
│   └── [id]/                     # per-session read/archive/delete actions
├── opencode-events/              # SSE fan-in endpoint
├── opencode-config/              # Oh My OpenAgent config read/update + status helper
├── opencode-models/              # model listing helpers
└── profiles/                     # profile CRUD, apply, import/export
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Session list + parent/child merge | `src/app/api/sessions/route.ts` | 900+ line hub with sticky status logic |
| Per-session archive/delete | `src/app/api/sessions/[id]/archive/route.ts`, `src/app/api/sessions/[id]/delete/route.ts` | mutation endpoints |
| Realtime event proxy | `src/app/api/opencode-events/route.ts` | multi-port SSE connect + stream forwarding |
| Config filtering + validation | `src/app/api/opencode-config/route.ts` | allowlists + sensitive-field rejection |
| Profile import/export | `src/app/api/profiles/import/route.ts`, `src/app/api/profiles/[id]/export/route.ts` | schema validation + download response |

## CONVENTIONS
- Route shape is file-based: one handler module per `route.ts`.
- Mutating resource actions are nested under resource id paths (`[id]/archive`, `[id]/delete`, `[id]/apply`, `[id]/export`).
- OpenCode access is discovery-first (`discoverOpencodePortsWithMeta`), then best-effort across all discovered ports.
- Error responses consistently use structured JSON with explicit HTTP statuses (`400` validation, `403` forbidden fields, `503` service unavailable).
- API tests are co-located with handlers (for example `route.test.ts` next to `route.ts`).

## ANTI-PATTERNS
- Do not hardcode a single OpenCode port; all critical routes iterate discovered ports.
- Do not accept secret-like config keys in `/api/opencode-config`; sensitive field names are explicitly blocked.
- Do not add unknown config fields for agents/categories/vibepulse; handlers enforce per-field allowlists.
- Do not skip rollback on profile import failures; import route restores index state when config write fails.
- Do not collapse discovery timeout and not-found responses; handlers distinguish these cases for user guidance.
