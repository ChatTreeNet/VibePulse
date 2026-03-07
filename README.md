# VibePulse

Real-time dashboard for monitoring and managing OpenCode sessions.

![VibePulse README cover](./public/readme-cover.png)

## Features

### Session Management
- **Real-time sync** — Automatically syncs OpenCode sessions via SSE + polling
- **4-column board** — Idle, Busy, Review, Done
- **Drag & drop** — Reorder cards within columns
- **IDE integration** — Click to open workspace in VSCode / Antigravity
- **Audio notifications** — Sound alerts when sessions complete or need attention
- **Process hints** — Detects OpenCode processes without exposed API ports
- **Offline snapshot** — Displays last known state when OpenCode is unreachable
- **Auto-generated cards** — No manual card creation needed

### Configuration Management (New)
- **Profile System** — Create and manage multiple configuration profiles for different workflows
  - Built-in profiles (e.g., "Balanced") with optimized agent/category configurations
  - Custom profiles with user-defined settings
  - One-click profile switching
  - **Reset to Profile** — After applying a profile, if you modify configs elsewhere, click "Reset" to restore the profile's original values (with confirmation dialog)
- **Agent Configuration** — Configure models, temperature, and other parameters for each agent (sisyphus, oracle, librarian, etc.)
- **Category Configuration** — Set up model preferences for different task categories (visual-engineering, ultrabrain, deep, quick, etc.)
- **Model Selector** — Smart model selection with grouped providers and search; shows error state with retry button if model fetch fails

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

### Session Management
1. Discovers OpenCode instances via port scanning and process detection
2. Fetches sessions from OpenCode SDK with 5-second polling
3. SSE connection provides real-time updates for immediate feedback
4. Multi-layer status detection (see [docs/session-status-detection.md](./docs/session-status-detection.md)):
   - Analyzes message part states (running/completed/waiting)
   - Applies sticky state buffering to prevent flickering
   - Cascades child session status to parent sessions
5. Cards are auto-generated and organized into kanban columns

### Configuration Management
1. **Profiles** are stored in `~/.config/opencode/profiles/`
2. **Applying a Profile** overwrites your current agent and category configurations
3. **Reset Functionality** — When a profile shows "Reset" button:
   - The profile was previously applied but configs have been modified
   - Click "Reset" and confirm to restore the profile's original values
4. **Model Fetching** — Models are fetched from `opencode models` CLI command; if it fails, an error state is shown with a retry button (no fallback models)

## Troubleshooting

### Configuration Management

#### Models not loading / "Failed to fetch models" error
- Ensure `opencode` CLI is installed and available in your PATH
- Check that `~/.opencode/bin` is in your PATH
- Click the **Retry** button in the model selector to attempt fetching again
- Run `opencode models` in your terminal to verify CLI is working

#### Profile Reset not working
- Make sure the profile was previously applied (shows "Reset" button instead of "Apply")
- The reset requires confirmation — check that you clicked "Reset" in the confirmation dialog
- If configs still don't reset, try re-applying the profile from the profile list

#### Board shows "No sessions found"
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
