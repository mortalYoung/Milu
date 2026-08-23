# CLAUDE.md

Guidance for agents working in this repository.

## Project

LETTERS — a minimal agent-harness desktop app: the pi agent harness's
**double loop** (`@earendil-works/pi-agent-core`) in an Electrobun shell with an
IM-style UI. Runtime: Bun (main process) + native webview.

- **Electrobun, NOT Electron** — never use Electron APIs or patterns.
- LLM layer: `@earendil-works/pi-ai`, DeepSeek provider.
- Window: `titleBarStyle: "hiddenInset"` (IDE-style, no title text) — the view's top strip is the drag region (`.electrobun-webkit-app-region-drag`), keep it.

## Architecture: the double loop

`src/bun/agent.ts` runs two nested loops:

- **Inner loop** — stream LLM → execute tool calls → feed results back → repeat until the model stops ("one turn").
- **Outer loop** — after a turn settles, drain queued follow-up/steering messages; keep going until nothing is left.

Rules an agent must respect:

- Agent idle → `agent.prompt(text)`; agent busy → `agent.followUp(...)` (outer loop drains it). If `prompt()` throws "Agent is already processing." (previous run still settling), queue as follow-up — never drop a message.
- Events → UI: `turn_start` → `agent_turn`, `message_update`/`text_delta` → `agent_delta`, `tool_execution_start/end` → `agent_tool`, `agent_end` → `agent_end` (`agent.state.errorMessage` on failure).

## RPC

`src/shared/rpc.ts` (`AppRPCSchema`) is the single source of truth — the generic for `BrowserView.defineRPC` (bun) / `Electroview.defineRPC` (view).

- `bun.requests` = webview calls Bun; `webview.messages` = Bun sends to webview (`rpc.send.*`, `rpc.addMessageListener`).
- Every request entry needs required `params` + `response` — pass `{}` at call sites (electrobun convention).
- Schema must be **type-only** — `satisfies` literals with inline type syntax break on unions.

## Conventions

- **No backward compatibility**: outdated code is deleted outright — no compatibility layers, no migrations, no fallbacks. The code serves the current design only; persisted data is append-only and never re-read with legacy adapters.
- **Simplicity**: implement the simplest solution that satisfies the current need — no speculative abstraction, no unnecessary configuration layers, unless the user explicitly asks for them.
- **Modularity & separation of concerns**: components stay small and single-purpose; boundaries follow the data flow, one way only — on the bun side `persist/` → `core/` → `tools/` → agent → `index.ts` (composition root), in the view `App.tsx` (controller) → layouts/components (render only, no RPC). Concretely: `src/bun/` splits into `persist/` (the session log layer — pi JSONL wiring in `store.ts`, event vocabulary + payloads in `events.ts`; everything that writes or reads the log), `core/` (agent runtime: `agent.ts` loop mechanics, `agent-config.ts` model/stream/projection, `prompt.ts` system prompt builder (IDENTIFY/PERSONA/WORKSPACE/STORAGE/RESPONSE-FORMAT/Caveats), `context.ts` double-loop context (lifecycle values + prompt assembly), `surface.ts` log→surface→dialogue derivation (read-only), `trajectory.ts` fold, `config.ts` constants), `lib/` (settings + path glue: app settings load/save, partner dir resolution, per-partner workspace/sandbox-mode/prompt-dedup files — the leaf layer `index.ts` composes, not defines) and `tools/` (`execution-env.ts` Bun fs/shell, `index.ts` tool assembly: read/write/edit/bash + send_message), `sandbox/` (per-platform confinement adapter — Seatbelt on macOS; fail-closed); the webview side is `layouts/Transcript.tsx` (document rendering) + `components/` (Button, Composer) + `App.tsx`.
- **Persistence**: conversation history is stored via pi's JSONL session layer (`JsonlSessionRepo`/`Session` in `src/bun/persist/store.ts`, root from the required `DATABASE_ROOT` env var — see `.env.example`; append-only, torn-write repaired). Full process data is stored (thinking/tool_use/tool_result blocks as pi messages); the event vocabulary (`persist/events.ts` — turn/start·end, step/start·end, tool/call·result, request/header, compaction, escalation) is appended as custom entries. Scope appends are durability barriers (resolve when on disk), and `agent.ts` awaits them at the fail-closed checkpoints: step/start + request/header before the LLM call, tool/call before the tool runs, tool/result right after it, step/end before the next step. Tool results are `tool/result` events that fold into the surface; the frontend only shows user messages, `send_message` and escalation entries. The agent can only reach the user through the `send_message` tool (see `docs/2026-08-11-requirements.md`). Note: the `FileSystem` adapter's `joinPath` must join parts verbatim (no cwd prefix) — pi passes absolute segments and re-prefixing doubles paths.
- **Correspondence visual system** (see `DESIGN.md`, qiaomu-design option B): `src/mainview/style.css`'s `@theme` holds the tokens — old paper `#f7f3ea`, letter `#fffdf8`, warm ink `#2a2620`, seal red `#b03a2e`, hairline `#e2dccb`. Strict font roles: Newsreader (serif) only for reading bubbles, Public Sans only for UI, JetBrains Mono only for inline code. Structure: icon rail + letter list + envelope header + bubbles (user warm-ink / agent letter + signature line + postmark time) + running indicator (trailing "speaking" letter bubble; ink dots on the selected list row and header) + paper input. Motion: agent messages "postmark" in (scale .96 + rotate .4° → settle), press scale .97, `prefers-reduced-motion` fallback. No shadows, no gradients, no left vertical decoration (P-38).
- The view is built by **Vite** (`vite.config.ts`: root `src/mainview`, Solid + Tailwind plugins, output `dist/` — git-ignored); electrobun copies `dist/index.html` + `dist/assets` into the bundle (`watchIgnore: ["dist/**"]`). The view stack is **Solid** (signals — the transcript's streaming text is a per-entry signal, so deltas patch one text node).
- TS strict + `verbatimModuleSyntax` (`import type`); env vars via `process.env["NAME"]`; match surrounding style (tabs).
- **Comments**: Avoid comments unless necessary; when you do comment, write **why** (why this approach, why not the alternative), not **what** (the code already says what it does).
- **Tests**: temporarily suspended — new requirements add no test cases, and changes don't need to pass the test suite (typecheck and format still apply).
- **Format**: don't run `format` after every change — only when asked, or when `format:check` fails.
- **Build**: no dev view build after changes — don't run `bun run dev` / `bun run build:view` after every change; only when asked, or when a fresh view build is required to verify.
- **Language**: ONLY English in CLAUDE.md and `src/` — code, comments, test names, UI strings, and this file itself contain no Chinese; other docs are English-first.
- `index.html` must load the view as `<script type="module" src="index.js">` — the raw `.ts` is not served; a wrong `src` fails silently (view JS never runs).

## Commands

`bun run dev` (Vite build + launch, no watchers — restart manually to pick up changes) · `bun run build` · `bun run build:view` (Vite) · `bun run dev:view` (Vite watch) · `bun run typecheck` · `bun run format` / `format:check` (Biome; config in `biome.json`, formatter-only, linter disabled)

## Environment

- `DEEPSEEK_API_KEY` (required) and optional `PI_MODEL` go in the project-root `.env` (git-ignored, see `.env.example`); `dev`/`start` load it via `bun --env-file=.env`. The agent reads `process.env` per request, so key changes apply without restart.
- Missing key is not a crash: pi streams an error → `agent_end` with `errorMessage` → `ERR §` in the UI.
- Tools: `read`/`write`/`edit`/`bash` (pi harness tools, see `agent-config.ts` — `createExecutionEnv` backs them with Bun fs + `/bin/sh`; cwd is the app's working directory). Tool failures surface as error results, not crashes.
- Sandbox (macOS): bash runs under a Seatbelt `sandbox-exec` profile (`src/bun/sandbox/`). Per-partner mode `read-only` / `workspace-write` / `danger-full-access` is chosen in the composer and persisted to `<partnerDir>/sandbox.json`. Kernel-denied writes return `[sandbox: file access denied under <mode> mode]`; the model may retry once with a strictly wider mode behind a human Approve/Reject dialog. No usable backend ⇒ confined calls fail closed (`sandbox unavailable`).
- Smoke test: with a key set, ask it to "list the files here" (tool call), then type another message mid-stream (follow-up drain).
