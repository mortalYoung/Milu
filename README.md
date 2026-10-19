# Milu

An agent harness with a server backend — one WebSocket protocol, two front ends: web and desktop.

> **Status: rebuild in progress.** This branch is greenfield — nothing runs yet.
> The previous implementation (303 commits, single package, Electrobun) is kept in full at
> tag `archive/v1` and branch `master`.

## What it is

You pick a chat. It reads files, runs commands, and replies. Everything runs on your machine:
no account, no server of ours, no telemetry, keys and data on disk.

## Shape

```
packages/di/          lifecycle vocabulary — Disposable, DisposableStore, Service.
packages/protocol/    the wire — requests, responses, events. Zero runtime dependencies.
packages/core/        the harness: services, extensions, no container wiring. No DOM, no sockets.
packages/client/      the browser side — connection, per-chat state, surface registry. No React.
packages/server/      the transport adapter — HTTP for the page, WebSocket for the protocol.
packages/web/         the React surfaces and the browser entry (Vite).
packages/bootstrap/   the composition roots — createBackend, createFrontEnd, bootstrap-web.ts.
packages/desktop/     Electron shell — a window around that same loopback server.
```

One entry per end. `bun run server` executes `packages/bootstrap/src/bootstrap-web.ts`, which
builds the core, starts the transport, and serves the built page; the browser entry calls
`createFrontEnd` and mounts the shell. Desktop will do the same with the in-process core.

The core never learns how it is reached. It emits typed events; a transport adapter at the
edge decides who hears about them. Desktop is not a special case: the shell boots the backend
in-process, loads `http://127.0.0.1:<port>/` into a `BrowserWindow`, and connects over `ws://`
— exactly like the browser does.

The core is runtime-neutral, so the same code serves both: Electron's main process is Node,
and a standalone server is Node too. Nothing reaches for a Bun-only API.

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
bun run dev             # the core on :8787 and Vite on :5173, in one terminal
bun run web:build       # the page the core serves in production
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
