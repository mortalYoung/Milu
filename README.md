# CODING DESKTOP

A minimal agent-harness desktop app. The **[pi agent harness](https://pi.dev)** double loop running inside an **[Electrobun](https://electrobun.dev)** window, styled like an instant messenger.

```
        ┌─────────────────────────────────────────┐
        │            CODING DESKTOP                │
        │  ───────────────────────────────────────  │
        │                       what time is it?   │
        │        ┌───────────────────────┐         │
        │        │ ▍                     │  21:34  │
        │        └───────────────────────┘         │
        │      ⇢ now · ran ✓                       │
        │  AGENT: IDLE                              │
        │  ( type a prompt … )  STOP  NEW [SEND ↗] │
        └─────────────────────────────────────────┘
```

IM structure with FT editorial dressing: pink paper background
(`#FFF1E5` — the salmon-pink paper FT has printed on since 1888),
white agent cards vs dark-slate user bubbles, Georgia serif message
text, teal status accents, flat print buttons, serif wordmark on the
pink hero strip.

## The double loop

The agent is built on `@earendil-works/pi-agent-core`, whose `runLoop` is a double nested loop:

- **Inner loop** — stream the LLM response; if it emits tool calls, execute them and feed the results back to the model; repeat until the model stops.
- **Outer loop** — after a turn settles, drain queued *follow-up* / *steering* messages; keep running until nothing is left.

Every message you type starts a `prompt()` run. Messages typed **while the agent is busy** are queued via `followUp()` and picked up by the outer loop — watch the status bar: `RUNNING · TURN n` counts inner-loop turns, `· n queued` shows the outer loop at work.

The standard toolset — `read`, `write`, `edit`, `bash` — runs in a Bun-backed
execution environment (filesystem + shell, cwd = the app's working directory)
and demonstrates the inner loop (LLM → tool → result → LLM). Try: "list the
files in the current directory" or "create a file and edit it".

## Stack

| Layer | Choice |
|-------|--------|
| Shell | [Electrobun](https://electrobun.dev) (Bun main process + native webview) |
| Agent runtime | [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) |
| LLM layer | [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) (unified multi-provider) |
| Provider | DeepSeek (`deepseek-v4-flash`, OpenAI-completions API) |
| View | Solid + Vite + Tailwind v4, FT editorial style — pink paper `#FFF1E5`, warm ink, Playfair Display serif, teal accents (palette measured from ft.com) |

## Getting started

```bash
bun install
cp .env.example .env             # then put your DEEPSEEK_API_KEY in .env
bun run dev                      # dev mode with watch (.env is auto-loaded)
```

`.env` lives in the project root and is git-ignored — the dev scripts load it via
`bun --env-file=.env`, so the key reaches the main process without shell exports.
Optional: `PI_MODEL=deepseek-v4-pro` in `.env` to switch models (anything in
pi-ai's deepseek catalog).

> No key set? The app still runs — the agent replies with an `ERR §` line telling you so.

## How it fits together

```
 mainview (zine UI)
   │  RPC: chat / stop / reset (requests)     ← src/shared/rpc.ts is the single
   │  RPC: agent_delta · agent_turn ·          source of truth for the wire format
   │       agent_tool · agent_end (messages)
   ▼
 src/bun/index.ts — window + RPC handlers
   ▼
 src/bun/agent.ts — the pi Agent (double loop), one tool: `now`
   ▼
 pi-ai streamFn → DeepSeek API
```

## Project structure

```
src/
├── bun/
│   ├── index.ts        # composition root: window + RPC wiring
│   ├── agent.ts        # pi Agent: double loop, events, chat semantics
│   └── agent-config.ts # model, stream fn, system prompt, tools, execution env
├── mainview/           # built by Vite (vite.config.ts) into dist/ (git-ignored)
│   ├── index.html      # Vite entry
│   ├── index.tsx       # bootstrap: render <App/> into #app
│   ├── App.tsx         # controller: RPC wiring, app state, shell chrome
│   ├── Transcript.tsx  # document rendering (Solid, per-entry streaming signals)
│   ├── Composer.tsx    # input field + dual-mode send/stop button
│   ├── style.css       # Tailwind v4 source: FT theme + component styles
│   └── assets/fonts/   # Playfair Display + Inter (OFL), bundled by Vite
└── shared/
    └── rpc.ts          # AppRPCSchema (typed requests/messages, shared both sides)
```

## Commands

| Command | What it does |
|---------|--------------|
| `bun run dev` | Vite build, then dev mode with watch |
| `bun run dev:view` | Vite watch (rebuild the view on change) |
| `bun run build` | Vite build, then production build |
| `bun run build:view` | build the view with Vite (Solid + Tailwind) |
| `bun run format` | format everything with Biome |
| `bun run format:check` | verify formatting (CI-friendly) |
| `bun run typecheck` | `tsc --noEmit` |

## Roadmap

- Permission prompt for the built-in tools (bash currently runs with the app's permissions, no sandbox)
- Conversation persistence (pi's JSONL session backend)
- Provider/model picker in the UI
- Tool-call streaming progress in the transcript
