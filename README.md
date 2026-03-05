# VibePulse

Real-time dashboard for monitoring and managing OpenCode sessions.

![VibePulse README cover](./public/readme-cover.png)

## Features

- **Real-time sync** — Automatically syncs OpenCode sessions via SSE + polling
- **4-column board** — Idle, Busy, Review, Done
- **Drag & drop** — Reorder cards within columns
- **IDE integration** — Click to open workspace in VSCode / Antigravity
- **Audio notifications** — Sound alerts when sessions complete or need attention
- **Process hints** — Detects OpenCode processes without exposed API ports
- **Offline snapshot** — Displays last known state when OpenCode is unreachable
- **Auto-generated cards** — No manual card creation needed

## Tech Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- @dnd-kit (drag and drop)
- TanStack Query (state management)
- @opencode-ai/sdk

## Getting Started

```bash
# Install dependencies
npm install

# Make sure OpenCode is running locally, then:
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│  Next.js    │────▶│  OpenCode   │
│             │◀────│    API      │◀────│    SDK      │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       └───────────────────┘
          SSE Events (real-time)
```

📖 **Session Status Detection**: See [docs/session-status-detection.md](./docs/session-status-detection.md) for detailed explanation of how session statuses are detected, including the sticky state mechanism and detection limitations.

## How It Works

1. Discovers OpenCode instances via port scanning and process detection
2. Fetches sessions from OpenCode SDK with 5-second polling
3. SSE connection provides real-time updates for immediate feedback
4. Multi-layer status detection (see [docs/session-status-detection.md](./docs/session-status-detection.md)):
   - Analyzes message part states (running/completed/waiting)
   - Applies sticky state buffering to prevent flickering
   - Cascades child session status to parent sessions
5. Cards are auto-generated and organized into kanban columns

## Troubleshooting

### Board shows "No sessions found"
- Ensure OpenCode is running locally
- Check that the SDK can connect (port conflicts)
- Look for the ℹ️ icon in the header for process hints

### Session status flickers or seems inaccurate
- This is a known limitation due to sparse OpenCode status signals
- See [docs/session-status-detection.md](./docs/session-status-detection.md) for detailed explanation
- The board uses 25-second sticky buffering to reduce flickering

### IDE doesn't open
- Make sure VSCode / Antigravity is installed
- Check that the corresponding protocol handler is registered (e.g. `vscode://`)

### Prevent VSCode from replacing an existing window

Open VSCode Settings (JSON) and add:

```json
"window.openFoldersInNewWindow": "on"
```

## Known Limitations

- Single user only (no collaboration)
- Card positions stored in LocalStorage only
- Cannot focus specific IDE window (opens workspace)
- No manual card creation/editing
- Session status detection has inherent limitations (see [docs/session-status-detection.md](./docs/session-status-detection.md))

## License

MIT
