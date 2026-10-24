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
- **The core is runtime-neutral.** It runs in Electron's main process today, and could move to a utility process or another shell tomorrow without changing a line. So no Electron, DOM or Bun-only API — `Bun.serve`, `Bun.file`, `bun:sqlite` — and no Bun-shaped types. v1 already satisfies this: it imports only `node:*`, and `pi-agent-core` declares `node >=22`. Keep it that way.
- **A service declares its dependencies; the container builds it.** Services are identified by tokens (`ISessionService`), registered into a `ServiceCollection` as instances, factories or `SyncDescriptor`s, and built by `InstantiationService.createInstance`, which resolves the constructor parameters decorated with a token (`@ISessionService`) plus whatever static arguments the descriptor carries. Bun only applies parameter decorators when a `tsconfig.json` with `experimentalDecorators` is visible from the working directory, so `assertDependencies` turns a dropped decorator into a startup error instead of `undefined` fields.
- **A singleton is unique to its container, never to the module.** `export const foo = new Foo()` is the v1 mistake wearing a better name — same implicit ordering, same untestable coupling, and it _looks_ clean, so nobody revisits it. The container is the only global.
- **State has one owner and an explicit lifecycle.** One service owns each piece of mutable state, and it says out loud how it starts and how it stops (`create → initialize → dispose`). Watchers, timers, `AbortController`s and child processes are all disposed by their owner. v1 leaked every one of these.
- **Only state earns a service.** A pure function is a function. Wrapping `fuzzy`, `trajectory`, `token-meter` in a class adds a layer and buys nothing.
- **An extension declares its window widgets.** `widgets: [{ id, type, entry, export? }]` on the extension: `type` picks the registry (`slot` / `widget` / `dialog` / `trigger` / `service`), `entry` names the module relative to the extension root, `export` defaults to `default`. The window asks the backend for that list (`widgets`) and imports every entry from the URL it comes back with — a hashed chunk emitted from `widgets.json` for builtins, the package file for a disk extension — so the shell imports no extension code and holds no map of them. Loading happens before the container boots, so a widget may also be a front-end service. A packaged widget receives `{ id, data }` and nothing else: the rest of its surface is `useWidget`, `useSession`, `useCommand` and `useExtensionData(key)` from `globalThis.miluHost.api`, plus React from `globalThis.miluHost.react` — a packaged chunk cannot resolve a bare specifier, so the bridge is the only import it has. Builtin widgets keep the whole `Host` on purpose: they are the shell's own chrome. Which shape a widget gets is decided by its `source`, never mixed, and every packaged widget sits inside a boundary that renders a failure line instead of taking the tree down.
- **A packaged extension is a manifest plus a module.** `package.json` carries `milu.apiVersion`, `milu.widgets`, `milu.contributions` and `milu.services`; the host reads and validates that JSON and never imports the module. Activation is handed to a `utilityProcess` speaking the protocol in `core/src/extensions/host.ts`, and every tool the child registers becomes a host-side proxy. The child sees only the capability surface — `tools.register`, `actions.register`, `hooks.on`, `settings.declare`, `disposables` — never a live service; a host that exits is restarted (three attempts, then its registrations are torn down and the failure is recorded); `settingsChanged` keeps a declared point in the child in step with `settings.update`, and a manifest item whose `data` reads `{ "from": "extension", "key": … }` is resolved by asking the child for that key when the slot is read; without a host process a packaged extension fails loudly instead of running in the host.
- **An extension may declare DI services.** `{ id: ServiceId, create }` declarations are registered before boot, on either end — core through `declareExtensionServices`, the window through a window module's `services` export. The name carries the extension (`replies.state`), the container owns the lifecycle, and runtime registration stays closed, so a module-level singleton is still a bug.
- **An extension may expose a service across the process boundary.** `milu.services` in the manifest names `<extension>.<name>` plus its methods; the owner implements them in its own process and any caller reaches them by name — `context.services.get("acme.math").double(21)` — because a token is an object and objects do not cross. A service here is a method contract, not an object: calls are async, arguments and results must survive `structuredClone` (checked in the host, before the reply leaves), an unknown method names the service and the method, and an owner that is not running fails fast instead of queueing. The proxy re-resolves the owner on every call, so a restarted extension is invisible to callers. Never call another extension's service from your own `activate` — boot order is not a promise; call where the work happens. In v1 any extension may call any declared service; that is the local-install trust model, not an oversight.
- **Permission must never degrade silently.** v1's sandbox chain is empty on anything but macOS, so the gate quietly disappears. A missing sandbox is a hard failure, never a fallback.

## Packages

| Package                    | May depend on                                              | Never                                    |
| -------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `packages/protocol`        | nothing                                                    | any runtime                              |
| `packages/di`              | nothing                                                    | any runtime                              |
| `packages/extension-types` | `protocol`, the agent's tool types                         | any runtime                              |
| `packages/core`            | `protocol`, `di`, `extension-types`                        | Electron, DOM, sockets, Bun-only         |
| `packages/window`          | `di`, `protocol`, React, `zustand`, `markdown-it`, `shiki` | Electron, `core`, an extension, a shell  |
| `packages/extensions`      | `core`, `di`, `protocol`, `window`, React                  | Electron, `bootstrap`, the desktop shell |
| `packages/bootstrap`       | `core`, `extensions`, `window`, `di`                       | Electron, `desktop`                      |
| `packages/desktop`         | `core`, `protocol`, `bootstrap`, `extensions`, `window`    | —                                        |

`packages/extensions` is the extension set — one folder per extension, nothing else: the window runtime lives in `packages/window`, the host protocol in `core`.

`packages/protocol` and `packages/extension-types` are the published surface: they export `src/index.ts` in the workspace and `dist/` from a staged copy. `bun run release` builds both into `artifacts/<package>`, rewrites `workspace:` ranges, and prints the publish command; the workspace manifests stay `private` so nothing can publish them half-built.

`packages/bootstrap` is the only place that assembles: `createBackend` for the core container, `createFrontEnd` for the window container. Everything else exports, nothing else composes.

`packages/desktop` is the only place allowed to import Electron. Its main process boots the core and owns the IPC edge; its renderer is the React app, loaded from `milu://app/index.html` through a registered custom protocol. Make the boundary a build error, not a convention.

Booting the core in-process is what makes the desktop cheap: Electron's main process _is_ Node, so `desktop/main.ts` calls `createBackend` and answers the renderer over preload IPC. Splitting the core into a utility process later is a process-boundary change, not a code change — that is the point of runtime neutrality.

## Settled decisions

Do not re-open these without the user saying so.

1. **Single user.** No multi-tenancy, no auth system.
2. **One transport: Electron IPC.** Requests are `ipcRenderer.invoke("milu:request", method, params)`; events are `webContents.send("milu:event", ...)`; the renderer's `Transport` port is the only thing that knows the channel names. `Methods` is the only registry. No HTTP server, no WebSocket, no `BrowserView.defineRPC`.
3. **Desktop is one app.** Electron's main process boots the core in-process; the renderer loads from `milu://app/index.html` through a custom protocol (with a CSP) and talks over a preload bridge with `contextIsolation` and `sandbox`. No port, no token, no network surface. A web end would be another `Transport` adapter later, not another app.
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

## Extension styling

An extension renders inside the host's DOM and inherits the host's CSS. Only the rows the host's Tailwind build emitted exist, and `@source` names only our own sources — so a builtin widget's utilities (including arbitrary values) make it into the sheet, while a packaged widget's do not.

- **Tokens are the contract.** Base variables carry light and dark through `light-dark()`, so `var(--ink)`, `var(--ink-soft)`, `var(--muted)`, `var(--muted-soft)`, `var(--line)`, `var(--line-strong)`, `var(--surface)`, `var(--chrome)`, `var(--canvas)`, `var(--signal)`, `var(--link)`, `var(--hover)`, `var(--selected)`, `var(--caption)`, `var(--accent-teal)`, `var(--accent-amber)`, `var(--code-bg)`, `var(--code-block-bg)` and `var(--code-hairline)` follow the theme without knowing about it. There is no `--line-soft`: the softer hairline is `var(--color-line-soft)` (a `color-mix` of `--line`).
- **Owning CSS is allowed, scoped.** A packaged widget may ship its own stylesheet, served from its package; every selector is namespaced under `.milu-ext-<id>` so two extensions cannot collide.
- **Utility class names are not an API.** `bar-icon`, `welcome-btn` and friends are internal to the shell; a widget that copies them breaks silently on the next redesign. The same goes for every utility class in a packaged widget: the host's sheet never generated it.

## Prompt philosophy

Less is more — an application of Restraint to prompts. Write the shortest prompt that reliably produces the behavior. Delete rules the model already knows; don't duplicate guidance across the prompt, opening message, and tool descriptions; keep runtime facts out of static text and inject them per-run.

## Comment philosophy

No explanatory comments unless the user explicitly asks for one. Code should speak for itself — prefer clear names and structure over explanatory comments. If a comment seems necessary, the code likely isn't clear enough; improve the code instead.

The one allowed exception is **region-marker comments**: a short banner that labels a section inside a long composition function or controller (for example `// ——— feature controllers ———`). Region markers are structural, not explanatory, and should be the only comments added freely.
