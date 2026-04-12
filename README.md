# VibePulse

[![npm version](https://img.shields.io/npm/v/vibepulse)](https://www.npmjs.com/package/vibepulse)

A tiny dashboard that sits in your browser tab — tired of switching IDE tabs just to check which OpenCode sessions finished.

![VibePulse README cover](./public/readme-cover.png)

## What It Does

- **Kanban board** — Auto-discovers OpenCode sessions and host-global Claude Code sessions, organizes them into Idle / Busy / Review / Done
- **Remote Nodes** — Connect multiple VibePulse instances to a single hub for a unified view
- **Audio alerts** — Makes a sound when sessions complete or need attention
- **Zero setup** — No manual card creation; auto-scans ports and processes
- **Profile switcher** — Flip between Oh My OpenAgent presets without touching config files

## Claude Code Support
VibePulse includes experimental, capability-aware support for tracking local [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) sessions:
- **Host-Global Discovery:** Automatically detects all Claude Code sessions running on the machine, aggregating projects seamlessly.
- **Explicit Capabilities:** Supported actions are explicitly modeled per provider. Claude now supports VibePulse-managed `archive` and `delete`, while `openEditor` remains disabled until a provider-safe execution path is defined.
- **Visual Differentiation:** Mixed environments feature distinct visual indicators distinguishing OpenCode and Claude groups inside projects.
- **Robust Liveness Semantics:** Stale busy states and zombie parsing are prevented at the provider boundary using stricter liveness verification.
- **Polling Integration:** Claude status updates via polling only locally and remotely. Live SSE streams and real-time event parity are not supported.
- **Artifact-Backed Child Topology:** Child sessions are exposed only when verified by authoritative artifact-backed linkage. No transcript rendering is supported.

## Quick Start

### Hub Mode (Default)
Run VibePulse locally to monitor your local sessions and manage remote nodes.
```bash
npx vibepulse
```
Open http://localhost:3456

### Node Mode
Run VibePulse on a remote server to expose its local OpenCode and Claude Code sessions to a hub.
```bash
npx vibepulse --serve
```
Node mode requires an access token for security. See [Architecture](#architecture) for details.

## Features

| Feature | Description |
|---------|-------------|
| Hub & Node | Distributed architecture for monitoring multiple remote hosts |
| Real-time sync | SSE + polling for live session updates |
| Sticky states | 25s sticky window prevents status flickering |
| Offline snapshot | Shows last known state when a node is unreachable |
| IDE integration | Click to open workspace in VSCode / Antigravity |
| Config UI | Manage agent models and remote nodes through the interface |

## Architecture

VibePulse uses a Hub-and-Node architecture to aggregate OpenCode and Claude Code sessions across different machines.

1. **Node**: A VibePulse instance running with `--serve`. It interacts directly with the local OpenCode SDK and Claude Code file-system artifacts and exposes an API.
2. **Hub**: The primary VibePulse instance (default mode). It connects to one or more Nodes to collect session data.

### Connecting a Remote Node
1. Start the remote node: `VIBEPULSE_NODE_TOKEN=your-secret npx vibepulse --serve`
2. Open your local VibePulse Hub.
3. Click the **Host Manager** icon.
4. Click **Add Remote Node**.
5. Enter the Node URL (e.g., `http://remote-server:3456`) and the Access Token.

## Development

```bash
git clone https://github.com/ChatTreeNet/VibePulse.git
cd VibePulse
npm install
npm run dev
```

### Claude Integration Verification
If modifying Claude Code integration, run the targeted regression matrix to ensure discovery order, bounded idle fallback, capability alignment, artifact-backed child topology, stronger liveness semantics, and mixed Claude/OpenCode visual behavior all stay intact:

| Area | Command |
|------|---------|
| Claude discovery + topology rules | `npm run test:run -- src/lib/session-providers/claudeCode.test.ts` |
| Capability alignment + rejection | `npm run test:run -- src/lib/session-providers/providerIds.test.ts src/app/api/sessions/route.test.ts` |
| Mixed project-group visual behavior | `npm run test:run -- src/components/ProjectCard.test.tsx src/components/SessionCard.test.tsx` |
| Local provider aggregation and route wiring | `npm run test:run -- src/lib/transform.test.ts src/hooks/useOpencodeSync.test.ts src/app/api/node/sessions/route.test.ts` |

```bash
npm run test:run -- src/lib/session-providers/providerIds.test.ts src/lib/session-providers/claudeCode.test.ts src/components/ProjectCard.test.tsx src/components/SessionCard.test.tsx src/app/api/sessions/route.test.ts src/app/api/node/sessions/route.test.ts src/lib/transform.test.ts src/hooks/useOpencodeSync.test.ts
npm run lint && npm run build
```

## Tech Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + @dnd-kit
- TanStack Query + @opencode-ai/sdk

## License

MIT
