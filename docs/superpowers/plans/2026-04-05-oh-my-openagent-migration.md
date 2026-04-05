# Oh My OpenAgent Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update VibePulse to use the new `oh-my-openagent` integration naming and config basename without renaming OpenCode runtime concepts.

**Architecture:** Keep all OpenCode runtime surfaces intact (`opencode` CLI/process/session semantics, SDK, discovery, and API route names). Limit the migration to the Oh My OpenAgent integration layer: config basename/schema, exported integration type names, and user/internal documentation that refers to the old plugin name.

**Tech Stack:** Next.js App Router, TypeScript, comment-json, Vitest

---

### Task 1: Switch canonical config metadata to oh-my-openagent

**Files:**
- Modify: `src/lib/opencodeConfig.ts`
- Modify: `src/lib/profiles/storage.ts`
- Test: `src/lib/opencodeConfig.test.ts`
- Test: `src/lib/profiles/storage.test.ts`

- [ ] Update the canonical config basename to `oh-my-openagent.jsonc`.
- [ ] Update the canonical schema URL to the upstream `oh-my-openagent` schema.
- [ ] Keep profile storage schema injection aligned with the shared config schema constant.
- [ ] Update tests to assert the new basename and schema.

### Task 2: Rename the exported plugin config type

**Files:**
- Modify: `src/types/opencodeConfig.ts`
- Modify: `src/index.ts`

- [ ] Rename `OhMyOpencodeConfig` to `OhMyOpenAgentConfig`.
- [ ] Update surrounding comments so they describe the new integration name.
- [ ] Re-export the renamed type from the public package surface.

### Task 3: Update scoped UI and documentation copy

**Files:**
- Modify: `src/components/opencode-config/ConfigButton.tsx`
- Modify: `src/app/api/opencode-config/status/route.ts`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `src/components/AGENTS.md`
- Modify: `src/app/api/AGENTS.md`

- [ ] Update user-facing labels that still mention the old plugin/integration name.
- [ ] Fix the status-route comment so it describes the OpenCode CLI correctly.
- [ ] Update project/internal docs to describe the config UI as Oh My OpenAgent integration management.

### Task 4: Verify the migration

**Files:**
- Check: changed files above

- [ ] Run diagnostics on changed source files.
- [ ] Run targeted tests for config/profile handling.
- [ ] Run lint and build to catch repo-wide integration issues.
