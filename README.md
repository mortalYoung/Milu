<div align="center"><a name="readme-top"></a>

<img height="140" src="packages/desktop/build/icon.png" alt="Milu">

<h1>Milu</h1>

A working agent harness.

![Static Badge](https://img.shields.io/badge/Agent-Harness-faf9f5?labelColor=%23f5f0e8)
![Static Badge](https://img.shields.io/badge/Milu-181715)

![](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)

</div>

## Quick Start

[Releases](https://github.com/mortalYoung/Milu/releases)

### Development

```bash
bun install
bun run dev             # Vite + Electron, main/preload bundled first
bun run build           # package artifacts/Milu-<version>-arm64.dmg
```

## Features

- **Less is more** — keep everything just enough: a minimal prompt, a simple interface,
  fewer tools.
- **Optional workspace** — run a chat with no workspace at all for statistics or other
  global work.
- **Memory** — each chat keeps its own memory, split into facts, issues and decisions.
  Keep talking and it grows into scenes, SOPs and a persona that sounds like you.
- **Long-term chat** — memory and cache hits wired in, so one chat per partner always
  works in context.
- **Keyboard** — `⌘P` opens a palette over chats, files and access: switch chat, jump to a
  file, or give a chat skills and MCP servers.
- **Permission** — a hard ceiling on the agent: a seatbelt sandbox confines what it can
  write, a wider mode needs a human to say yes, and `rm` only runs after the move to the
  trash has failed.
- **Local** — everything runs on your machine: no account, no server, no telemetry, and
  your keys and data stay on disk.
- **Everything as a log** — sessions are append-only, and every view is built from them:
  transcript, trajectory, replies, git diff, explorer.

---

<div align="center">

<sub>Made with a fountain pen.</sub>

</div>
