# VibePulse

[![npm version](https://img.shields.io/npm/v/vibepulse)](https://www.npmjs.com/package/vibepulse)

Current version: **0.1.7**

A tiny dashboard that sits in your browser tab — tired of switching IDE tabs just to check which OpenCode sessions finished.

![VibePulse README cover](./public/readme-cover.png)

## What It Does

- **Kanban board** — Auto-discovers OpenCode sessions, organizes them into Idle / Busy / Review / Done
- **Audio alerts** — Makes a sound when sessions complete or need attention
- **Zero setup** — No manual card creation; auto-scans ports and processes
- **Profile switcher** — Flip between OMO presets without touching config files

## Quick Start

```bash
npx vibepulse
```

Open http://localhost:3456

## Features

| Feature | Description |
|---------|-------------|
| Real-time sync | SSE + polling for live session updates |
| Sticky states | 25s sticky window prevents status flickering |
| Offline snapshot | Shows last known state when OpenCode is unreachable |
| IDE integration | Click to open workspace in VSCode / Antigravity |
| Config UI | Manage agent models and profiles through the interface |

## Development

```bash
git clone https://github.com/ChatTreeNet/VibePulse.git
cd VibePulse
npm install
npm run dev
```

## Architecture

```
Browser ← SSE/Polling → Next.js API ←→ OpenCode SDK
```

Session status detection uses multi-layer analysis with sticky state buffering. See [docs/session-status-detection.md](./docs/session-status-detection.md) for details.

## Tech Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + @dnd-kit
- TanStack Query + @opencode-ai/sdk

## License

MIT
