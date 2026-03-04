# VibePulse

Real-time dashboard for monitoring and managing OpenCode sessions.

![VibePulse README cover](./public/readme-cover.png)

## Features

- **Real-time sync** — Automatically syncs OpenCode sessions via SSE
- **4-column board** — Idle, Busy, Review, Done
- **Drag & drop** — Reorder cards within columns
- **IDE integration** — Click to open workspace in VSCode / Antigravity
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

## How It Works

1. Sessions are fetched from OpenCode SDK
2. SSE connection provides real-time updates
3. Cards are auto-generated from session data
4. Status mapping:
   - `busy` → Busy
   - `idle` → Idle
   - `question.asked` / `permission.asked` → Review
   - `retry` → Review
   - `archived` → Done

## Troubleshooting

### Board shows "No sessions found"
- Ensure OpenCode is running locally
- Check that the SDK can connect (port conflicts)

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

## License

MIT
