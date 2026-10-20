# CLAUDE.md

Guidance for agents working in this repository — a design, not a rulebook. Decide by principle rather than prescribed behavior; facts live in the code and docs, this file steers judgment.

## Principles

- **Intent** — Understand the ask before acting: match its scope and spirit, not a literal reading. _Example: a "check the UI" request means analyze and report, not edit; a one-word "Fixed all" after a review means implement the agreed fixes._
- **Simplicity** — Implement the simplest solution that satisfies the current need; delete outdated code outright — no compatibility layers, no migrations, no fallbacks. _Example: this repo is greenfield. There is no legacy data and no released version, so nothing needs to keep working; delete freely._
- **Restraint** — Spend tool budget on what the task needs, not habits. _Example: don't run `format` or rebuild the view after every change — only when asked, or when a fresh check is required to verify. There is no test suite by design; `bun run typecheck`, `bun run lint` and `bun run format:check` are the gate, and the user verifies behavior._
- **Accountability** — Own your changes: keep edits minimal and targeted, report what you changed and why, and surface decisions you made on your own rather than burying them. **Never commit unless the user asks in that message** — land the change in the working tree and report it; the user writes the history.
- **Verification** — Confirm your work matches the ask before claiming done, and check claims against the code rather than memory. _Example: run `bun run typecheck` for TS changes; an assertion with no evidence is a guess._

## Architecture

The rebuild exists to enforce these rules. Break one and the reason for the rebuild is gone.

- **The core does not know how it is reached.** `packages/core` never imports Electron, never opens a socket, never touches `DOM`. It emits typed events and returns values; a transport adapter at the edge decides who hears about it. No `rpc.send.*` anywhere inside the domain.
- **The core is runtime-neutral.** The same code runs under Electron's Node (in-process, for the desktop) and under a standalone server (for the browser). So no Bun-only API — `Bun.serve`, `Bun.file`, `bun:sqlite` — and no Bun-shaped types. v1 already satisfies this: it imports only `node:*`, and `pi-agent-core` declares `node >=22`. Keep it that way.
- **A singleton is unique to its container, never to the module.** `export const foo = new Foo()` is the v1 mistake wearing a better name — same implicit ordering, same untestable coupling, and it _looks_ clean, so nobody revisits it. The container is the only global.
- **State has one owner and an explicit lifecycle.** One service owns each piece of mutable state, and it says out loud how it starts and how it stops (`create → initialize → dispose`). Watchers, timers, `AbortController`s and child processes are all disposed by their owner. v1 leaked every one of these.
- **Only state earns a service.** A pure function is a function. Wrapping `fuzzy`, `trajectory`, `token-meter` in a class adds a layer and buys nothing.
- **An extension may declare services.** `{ id: ServiceId, create }` declarations are registered before boot, on either end — core through `declareExtensionServices`, the window through `createFrontEnd({ services })`. The name carries the extension (`replies.state`), the container owns the lifecycle, and runtime registration stays closed, so a module-level singleton is still a bug.
- **Permission must never degrade silently.** v1's sandbox chain is empty on anything but macOS, so the gate quietly disappears. A missing sandbox is a hard failure, never a fallback.

## Packages

| Package              | May depend on                              | Never                                               |
| -------------------- | ------------------------------------------ | --------------------------------------------------- |
| `packages/protocol`  | nothing                                    | any runtime                                         |
| `packages/di`        | nothing                                    | any runtime                                         |
| `packages/core`      | `protocol`, `di`                           | Electron, DOM, sockets, Bun-only                    |
| `packages/client`    | `protocol`, `di`                           | `core`, Node built-ins, DOM                         |
| `packages/markdown`  | `client` (types), `markdown-it`, `shiki`   | `core`, Node built-ins, Electron                    |
| `packages/server`    | `core`, `protocol`                         | Electron, DOM                                       |
| `packages/web`       | `client`, `protocol`, `bootstrap/frontend` | `core`, `bootstrap` (the Node side), Node built-ins |
| `packages/bootstrap` | `core`, `client`, `server`, Electron       | —                                                   |

`packages/bootstrap` is the only place that assembles: `createBackend` for the Node ends, `createFrontEnd` for the browser, `bootstrap-web.ts` for the web end. Everything else exports, nothing else composes.

`packages/desktop` (not yet built) is the only place allowed to import Electron. Make the boundary a build error, not a convention.

Booting the core in-process is what makes the desktop cheap: Electron's main process _is_ Node, so the desktop shell starts the same server `bootstrap-web.ts` would, on a loopback port, and the renderer connects to it like any browser. Splitting it into a child process later is a process-boundary change, not a code change — that is the point of runtime neutrality.

## Settled decisions

Do not re-open these without the user saying so.

1. **Single user.** No multi-tenancy, no auth system.
2. **One transport: WebSocket.** Desktop keeps no Electron IPC for the protocol. RPC _semantics_ stay — `id`-tagged request/response frames plus untagged event frames — but the protocol layer implements them, not `ipcRenderer` and not `BrowserView.defineRPC`.
3. **Desktop is a web client on loopback.** The shell boots the backend in-process, loads `http://127.0.0.1:<port>/` into a `BrowserWindow`, and the view opens `ws://127.0.0.1:<port>/ws`; web and desktop run the identical two paths. A random token in the window URL, checked at handshake — a loopback port is open to every process on the machine.
4. **Behavior over tests.** No test suite. The user verifies.

## v1 is a read-only reference

The previous implementation (303 commits, single package) is tag `archive/v1` and branch `master`. Read it, don't edit it — a reference that moves is no longer a reference.

```bash
git checkout archive/v1 -- <path>       # pull one file or directory forward
git show archive/v1:src/bun/index.ts    # read without touching the worktree
```

Still to bring forward: `assets/` (icon, wordmark, `gen-icons.sh`) and `.agents/` + `skills-lock.json` (the `qiaomu-design` skill — it exists nowhere else).

## UI philosophy

Render only the information the user needs immediately — everything else is collapsed behind a toggle, hover, or focus.

## Prompt philosophy

Less is more — an application of Restraint to prompts. Write the shortest prompt that reliably produces the behavior. Delete rules the model already knows; don't duplicate guidance across the prompt, opening message, and tool descriptions; keep runtime facts out of static text and inject them per-run.

## Comment philosophy

No explanatory comments unless the user explicitly asks for one. Code should speak for itself — prefer clear names and structure over explanatory comments. If a comment seems necessary, the code likely isn't clear enough; improve the code instead.

The one allowed exception is **region-marker comments**: a short banner that labels a section inside a long composition function or controller (for example `// ——— feature controllers ———`). Region markers are structural, not explanatory, and should be the only comments added freely.
