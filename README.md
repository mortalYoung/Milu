# Milu

An agent harness with a local core — one IPC protocol, one desktop shell.

> **Status: rebuild in progress.** The desktop shell runs; the web end is deferred.
> The previous implementation (303 commits, single package, Electrobun) is kept in full at
> tag `archive/v1` and branch `master`.

## What it is

You pick a chat. It reads files, runs commands, and replies. Everything runs on your machine:
no account, no server of ours, no telemetry, keys and data on disk.

## Shape

```
packages/di/          lifecycle vocabulary — Disposable, DisposableStore, Service.
packages/protocol/    the wire — methods, results, events. Zero runtime dependencies.
packages/core/        the harness: services, extensions, no container wiring. No DOM, no sockets.
packages/extensions/  everything but core — host runtime, markdown, actions, dialogs, widgets, slots.
packages/bootstrap/   the composition roots — createBackend, createFrontEnd.
packages/desktop/     Electron shell — main runs the core and the IPC edge; the renderer is the app.
```

`bun run dev` builds the main/preload bundle, starts Vite, and opens Electron against it.
`bun run build` produces `desktop/renderer/dist` and `desktop/dist-electron`; `bun run start`
loads the built renderer from `milu://app/index.html`.

The core never learns how it is reached. It emits typed events; the desktop's IPC edge decides
who hears about them. The renderer only knows the `Transport` port — a web end would be another
implementation of that port, not another app.

The core is runtime-neutral: Electron's main process is Node, and nothing in `core` reaches for
Electron, DOM or a Bun-only API.

## Principles

- **Less is more** — a minimal prompt, a simple interface, fewer tools.
- **Local** — no account, no server, no telemetry; keys and data stay on disk.
- **Everything as a log** — sessions are append-only, and every view is built from them:
  transcript, dashboard, trajectory, replies, git diff, explorer.
- **Permission is a ceiling** — the sandbox confines the agent, `rm` moves to the trash unless
  force-deleted, and anything wider needs a human to say yes.
- **Memory grows** — each chat keeps its own facts, issues and decisions, and over time they
  organize into scenes, SOPs, and a persona that sounds like you.
- **Keyboard first** — a palette to switch chats, open files, and grant a chat access to skills
  and MCP servers.

## Development

```bash
bun install
bun run dev             # Vite + Electron, main/preload bundled first
bun run build           # renderer/dist and dist-electron
bun run start           # Electron against the built renderer
bun run check           # tsc + oxlint + oxfmt + the package boundaries
```

There is no test suite by design; behavior is verified by hand. See `CLAUDE.md` for the
architecture rules and the decisions that are already settled.

## Reading v1

```bash
git show archive/v1:src/bun/index.ts            # read the old composition root
git checkout archive/v1 -- assets/ .agents/     # bring the icon set and the design skill forward
```

## Built on

[pi](https://pi.dev) · [pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core) ·
[pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) · [Electron](https://www.electronjs.org) ·
[MCP](https://modelcontextprotocol.io) · [CodeMirror](https://codemirror.net/) · [Shiki](https://shiki.style/)
