# Claude Capability Alignment Design

## Goal
Align Claude Code and OpenCode capabilities in VibePulse through an explicit capability matrix. We also need to fix stale busy status prediction and clearly differentiate providers in the UI.

## Context
VibePulse recently added global Claude discovery alongside read-only Claude cards. The footer open state is now restored. We still have a known stale-busy problem rooted in weak process ID validation. Current documentation describes Claude as read-only with no action parity. This specification defines the next expansion iteration to replace blunt read-only gating with specific capability flags.

## Non-goals
We won't build full feature parity for Claude if the underlying CLI lacks support. We also won't rewrite the core Next.js aggregation engine.

## Architecture
The architecture relies on our existing separation of concerns. Provider contracts live in `src/lib/session-providers/*` and `src/types/index.ts`. Transformation logic resides in `src/lib/transform.ts`. UI action gating happens in `src/components/ProjectCard.tsx`, `src/components/SessionCard.tsx`, and `src/components/KanbanBoard.tsx`. Action routes remain in `src/app/api/sessions/[id]/*`. Implementation is strictly scoped to these boundaries.

## Capability Model
We replace `readOnly` as our sole capability proxy with explicit action capabilities. A new capability matrix covers `openProject`, `openEditor`, `archive`, and `delete`. We keep the `readOnly` flag but narrow its meaning to indicate basic UI protection.

Current evidence shows Claude archive and delete official support is unclear. The capability matrix must allow staged enablement. We won't pretend parity exists. If Claude cannot safely archive a workspace, the matrix explicitly sets `archive: false`.

## Status Model
The busy status fix lives at the Claude provider boundary instead of being patched in the UI. When liveness evidence is weak, we prefer false-idle over false-busy for Claude. This specific logic prevents sessions from getting stuck in a busy state when the underlying process might actually be dead or sleeping.

## UI Design
Visual differentiation uses a mixed strategy. The interface will show a project-level primary provider identity. Individual session rows receive a lightweight indicator. Projects with sessions from multiple providers get explicit mixed-group treatment to avoid user confusion.

## API and Route Enforcement
Action routes in `src/app/api/sessions/[id]/*` must check the capability matrix before executing destructive actions. If a provider lacks the `archive` capability, the API must reject the request and return a clear error code.

## Testing Strategy
Tests will verify correct capability matrix enforcement in both UI components and API routes. We will add unit tests for the Claude provider status logic. This ensures the false-idle fallback works correctly under weak liveness conditions.

## Rollout Order
1. Provider contracts and status logic
2. UI action gating and visual differentiation
3. API action-route guards
4. Tests and documentation

## Risks
Staged capabilities might frustrate users if missing actions are not explained clearly in the UI. The strict idle fallback could mask active processes if PID checks fail due to obscure OS-level permission boundaries.
