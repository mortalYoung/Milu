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

- **Separation of concerns**: `src/bun/` splits into `core/` (agent runtime: `agent.ts` loop mechanics, `agent-config.ts` model/stream/projection, `prompt.ts` 四段系统提示词构建(IDENTIFY/PERSONA/TOOL-GUIDANCE/RESPONSE-FORMAT), `session.ts` persistence, `config.ts` constants) and `tools/` (`execution-env.ts` Bun fs/shell, `index.ts` tool assembly: read/write/edit/bash + send_message); `index.ts` at the root is the composition root. The webview only renders and talks RPC — `layouts/Transcript.tsx` (document rendering) + `components/` (Button, Composer) + `App.tsx` (controller: state, RPC wiring, shell chrome). Dependencies flow one way: core → tools → agent → index; layouts/components ← App.
- **Persistence**: conversation history is stored via pi's JSONL session layer (`JsonlSessionRepo`/`Session` in `src/bun/core/session.ts`, root from the required `DATABASE_ROOT` env var — see `.env.example`; append-only, torn-write repaired). Full process data is stored (thinking/tool_use/tool_result blocks as pi messages); the frontend only shows user messages and `send_message` custom entries. The agent can only reach the user through the `send_message` tool (see `docs/2026-08-11-requirements.md`). Note: the `FileSystem` adapter's `joinPath` must join parts verbatim (no cwd prefix) — pi passes absolute segments and re-prefixing doubles paths.
- **书信对话视觉系统** (见 `DESIGN.md`,qiaomu-design 四方向选定的 B):`src/mainview/style.css` 的 `@theme` 承载 tokens — 旧纸 `#f7f3ea`、信笺 `#fffdf8`、暖墨 `#2a2620`、封印红 `#b03a2e`、发丝线 `#e2dccb`。字体分工严格:Newsreader(衬线)只做阅读气泡、Public Sans 只做 UI、JetBrains Mono 仅内联代码。结构:图标栏 + 信件目录列表 + 信封抬头 header + 气泡(用户暖墨/agent 信笺 + 署名行 + 邮戳时间)+ 运行指示(末尾"正在说话"信笺气泡,列表选中行与 header 有墨点工作态)+ 纸面输入框。动效:agent 消息"盖邮戳"入场(scale .96 + rotate .4° → 归位)、按压 scale .97、`prefers-reduced-motion` 兜底。无阴影、无渐变、禁左侧竖线装饰(P-38)。
- The view is built by **Vite** (`vite.config.ts`: root `src/mainview`, Solid + Tailwind plugins, output `dist/` — git-ignored); electrobun copies `dist/index.html` + `dist/assets` into the bundle (`watchIgnore: ["dist/**"]`). The view stack is **Solid** (signals — the transcript's streaming text is a per-entry signal, so deltas patch one text node).
- TS strict + `verbatimModuleSyntax` (`import type`); env vars via `process.env["NAME"]`; match surrounding style (tabs).
- `index.html` must load the view as `<script type="module" src="index.js">` — the raw `.ts` is not served; a wrong `src` fails silently (view JS never runs).

## Commands

`bun run dev` (Vite build + electrobun watch) · `bun run build` · `bun run build:view` (Vite) · `bun run dev:view` (Vite watch) · `bun run typecheck` · `bun run format` / `format:check` (Biome; config in `biome.json`, formatter-only, linter disabled)

## Environment

- `DEEPSEEK_API_KEY` (required) and optional `PI_MODEL` go in the project-root `.env` (git-ignored, see `.env.example`); `dev`/`start` load it via `bun --env-file=.env`. The agent reads `process.env` per request, so key changes apply without restart.
- Missing key is not a crash: pi streams an error → `agent_end` with `errorMessage` → `ERR §` in the UI.
- Tools: `read`/`write`/`edit`/`bash` (pi harness tools, see `agent-config.ts` — `createExecutionEnv` backs them with Bun fs + `/bin/sh`; cwd is the app's working directory). Tool failures surface as error results, not crashes. `bash` runs with the app's permissions — there is no permission/sandbox layer yet.
- Smoke test: with a key set, ask it to "list the files here" (tool call), then type another message mid-stream (follow-up drain).
