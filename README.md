<div align="center"><a name="readme-top"></a>

<img height="140" src="assets/milu.png" alt="Milu">

<h1>Milu</h1>

A working desktop harness.

[![][bun-shield]][bun-link]
[![][electrobun-shield]][electrobun-link]
[![][typescript-shield]][typescript-link]
[![][tailwind-shield]][tailwind-link]<br/>
[![][mcp-shield]][mcp-link]

[Website](./README.md) · [Report Bug][github-issues-link]

![](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)

</div>

## Quick Start

### Download

[Releases](https://github.com/mortalYoung/letters/releases)

### Development

```bash
bun install
bun run dev
```

## Features

- **Less is More** — keep everything just enough for you: a minimal prompt, a simple
  interface, fewer tools.
- **Optional workspace** — run the agent without workspace for statistics or other global tasks.
- **Memory** — each chat keeps its own memory, split into facts, issues and decisions.
  Keep talking and it grows into SOPs and a persona that sounds like you.
- **Long-term chat** — memory and cache hits wired in, so one chat per partner always
  works in context.
- **Keyboard** — `⌘P` opens a palette to switch chats, open files, or give a chat access to
  skills and MCP servers.
- **Permission** — a hard ceiling on the agent: the sandbox confines it, `rm` is
  force-delete only, anything wider needs a human.
- **Local** — everything runs on your machine: no account, no server, no telemetry, and
  your keys and data stay on disk.
- **Everything as a log** — sessions are append-only, and every view is built from them:
  transcript, dashboard, trajectory, replies, git diff, explorer.

## Why not

- **Claude Code** — a nice model under a bad harness: a swollen prompt, 80% of its
  functions useless for normal scenes, and — the important part — no source to read.
- **Codex** — an expert at making things complex, then persuading you that's the point. An
  acquired taste, apparently compulsory.
- **Kimi Code** — a bad UI swollen with functions. Less is More? Never heard of it.
- **ZCode** — Schrödinger's *open-source*: you can't tell without opening the box — and GLM
  is in there either way.
- **dsh** — DeepSeek Harness: a talented harness — just don't hand it to a non-programmer.

---

<div align="center">

**Built on** — [pi](https://pi.dev) · [pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core) · [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) · [Electrobun](https://electrobun.dev) · [MCP](https://modelcontextprotocol.io) · [CodeMirror](https://codemirror.net/) · [Shiki](https://shiki.style/)

<sub>Made with a fountain pen.</sub>

</div>

[github-issues-link]: https://github.com/mortalYoung/letters/issues
[bun-shield]: https://img.shields.io/badge/Bun-1.4-fbf0df?labelColor=black&logo=bun&logoColor=white&style=flat-square
[bun-link]: https://bun.sh
[electrobun-shield]: https://img.shields.io/badge/Electrobun-2.0.1-2f6f9f?labelColor=black&style=flat-square
[electrobun-link]: https://electrobun.dev
[typescript-shield]: https://img.shields.io/badge/TypeScript-7-3178c6?labelColor=black&logo=typescript&logoColor=white&style=flat-square
[typescript-link]: https://www.typescriptlang.org
[tailwind-shield]: https://img.shields.io/badge/Tailwind-v4-38bdf8?labelColor=black&logo=tailwindcss&logoColor=white&style=flat-square
[tailwind-link]: https://tailwindcss.com
[mcp-shield]: https://img.shields.io/badge/MCP-stdio-2f6f9f?labelColor=black&style=flat-square
[mcp-link]: https://modelcontextprotocol.io
