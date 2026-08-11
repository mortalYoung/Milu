# CLAUDE.md

Guidance for agents working in this repository.

## Project

CODING DESKTOP — a minimal agent-harness desktop app: the pi agent harness's
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

- **Separation of concerns**: all agent/LLM logic lives in `src/bun/` — `agent.ts` (loop mechanics) + `agent-config.ts` (model/stream/prompt/tools). The webview only renders and talks RPC — `transcript.ts` (document rendering) + `index.ts` (controller: state, RPC wiring, shell chrome). Dependencies flow one way: config → agent → index; transcript ← controller.
- FT editorial style, set in Tailwind v4: the CSS source is `src/mainview/style.css` — `@theme` carries the FT tokens measured from ft.com (pink paper `#fff1e5`, warm ink `#33302e`, slate `#262a33`, teal `#0d7680`), Georgia serif for titles/bubbles, system sans for meta. IM structure retained (bubbles, timestamps, system lines, time separators — see `transcript.ts`). Flat print buttons — no glass/blur. `src/mainview/index.css` is a git-ignored build artifact — run `bun run build:css` (or `dev:css --watch`) instead of editing it.
- TS strict + `verbatimModuleSyntax` (`import type`); env vars via `process.env["NAME"]`; match surrounding style (tabs).
- `index.html` must load the view as `<script type="module" src="index.js">` — the raw `.ts` is not served; a wrong `src` fails silently (view JS never runs).

## Commands

`bun run dev` (watch) · `bun run build` · `bun run typecheck` · `bun run dev:css` (Tailwind watch, run alongside dev when editing CSS) · `bun run format` / `format:check` (Biome; config in `biome.json`, formatter-only, linter disabled)

## Environment

- `DEEPSEEK_API_KEY` (required) and optional `PI_MODEL` go in the project-root `.env` (git-ignored, see `.env.example`); `dev`/`start` load it via `bun --env-file=.env`. The agent reads `process.env` per request, so key changes apply without restart.
- Missing key is not a crash: pi streams an error → `agent_end` with `errorMessage` → `ERR §` in the UI.
- Tools: `read`/`write`/`edit`/`bash` (pi harness tools, see `agent-config.ts` — `createExecutionEnv` backs them with Bun fs + `/bin/sh`; cwd is the app's working directory). Tool failures surface as error results, not crashes. `bash` runs with the app's permissions — there is no permission/sandbox layer yet.
- Smoke test: with a key set, ask it to "list the files here" (tool call), then type another message mid-stream (follow-up drain).
