# CLAUDE.md

Guidance for Claude Code and other agents working in this repository.

## Project

CODING DESKTOP — a minimal agent-harness desktop app. The pi agent harness's
**double loop** runs in an Electrobun shell with a zine-style UI.

- Shell: [Electrobun](https://electrobun.dev) — **NOT Electron.** Never use Electron APIs or patterns.
- Agent runtime: `@earendil-works/pi-agent-core` (the `Agent` class wraps the double-nested `runLoop`)
- LLM layer: `@earendil-works/pi-ai` — provider-agnostic; app uses the DeepSeek provider
- Runtime: Bun (main process) + native webview (UI)

## Architecture: the double loop

The agent loop (`src/bun/agent.ts`) is two nested loops:

- **Inner loop** — stream LLM response → execute tool calls → feed results back → repeat until the model stops. One "turn".
- **Outer loop** — after a turn settles, drain queued follow-up/steering messages; keep going until nothing is left.

`Agent.chat()` semantics in `src/bun/agent.ts`:
- Agent idle → `agent.prompt(text)` (starts a run)
- Agent busy → `agent.followUp({role: "user", ...})` (outer loop drains it after the current turn)
- If `prompt()` throws "Agent is already processing." (previous run still settling) → queue as follow-up; the next run's drain point picks it up. Never leave a message dropped.

Events from `agent.subscribe()` drive the UI bridge: `turn_start` → `agent_turn`, `message_update` with `text_delta` → `agent_delta`, `tool_execution_start/end` → `agent_tool`, `agent_end` → `agent_end` (with `agent.state.errorMessage` on failure, e.g. missing API key).

## RPC

`src/shared/rpc.ts` is the single source of truth for the wire format — a hand-written schema TYPE (`AppRPCSchema`) passed as the generic to `BrowserView.defineRPC<AppRPCSchema>` (bun side, `src/bun/index.ts`) and `Electroview.defineRPC<AppRPCSchema>` (view side, `src/mainview/index.ts`).

Semantics (matching `defineElectrobunRPC`):
- `bun.requests` — methods the webview calls on Bun (handlers in `src/bun/index.ts`)
- `webview.messages` — fire-and-forget messages Bun sends to the webview (`rpc.send.agent_delta({text})`; view listens via `rpc.addMessageListener("agent_delta", ...)`)
- Every request entry must have a required `params` and `response` — optional params violate the `ElectrobunRPCSchema` constraint; pass `{}` at call sites (electrobun convention).
- Do NOT write the schema as a runtime object literal with inline type syntax (`{params: {text: string}}` as a value) — TS's `satisfies` type-literal parsing breaks on unions/semicolons. Type-only schema.

## Code conventions

- TypeScript strict, `noUnusedLocals/Parameters`, `verbatimModuleSyntax` (use `import type`), `noPropertyAccessFromIndexSignature` — env vars must be accessed as `process.env["NAME"]`.
- Tabs for indentation (matches existing files).
- Keep the transcript rendering in `src/mainview/index.ts`; all agent/LLM logic stays in `src/bun/` (the webview never talks to the provider).
- Zine style constraints in `src/mainview/index.css`: paper/ink/one red, no border-radius, no shadows, no gradients. Don't introduce web-app chrome.
- `src/mainview/index.html` must load the view script as `<script type="module" src="index.js">` — electrobun bundles the view entrypoint (`electrobun.config.ts` → `build.views.mainview.entrypoint`) to `index.js`; the dev server does NOT serve raw `index.ts`, and a wrong `src` fails silently with "empty response for URL: views://mainview/index.ts" (view JS never runs, UI appears dead).

## Commands

```bash
bun run dev        # dev mode with watch (launches the desktop app)
bun run build      # production build
bun run typecheck  # tsc --noEmit
```

## Environment

- `DEEPSEEK_API_KEY` — required for the agent to reply (provider: DeepSeek, OpenAI-completions API at api.deepseek.com)
- `PI_MODEL` — optional model override, e.g. `deepseek-v4-pro` (any id in pi-ai's deepseek catalog, see `node_modules/@earendil-works/pi-ai/dist/providers/data/deepseek.json`)
- Put both in the project-root `.env` (git-ignored; see `.env.example`). The `dev`/`start` scripts load it via `bun --env-file=.env`, and env propagates down the launcher spawn chain to the main process. Do not add new keys to the shell export docs — keep them in `.env`.
- The agent reads `process.env` at request time (pi auth resolution), so the key is picked up per turn without restart.
- Missing key is NOT a crash: pi encodes it as an error stream → `agent_end` with `errorMessage` → `ERR §` line in the UI.

## Verification

The double loop was verified against the live API: turn 1 (LLM → `now` tool → result), turn 2 (answer from tool result), turn 3 (mid-run follow-up drained by the outer loop), clean `agent_end`. To re-verify manually: set a key, `bun run dev`, ask "what time is it?" (tool call), then type another message while it streams (follow-up).
