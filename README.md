# CODING DESKTOP

A minimal agent-harness desktop app. The **[pi agent harness](https://pi.dev)** double loop running inside an **[Electrobun](https://electrobun.dev)** window, typeset like a printed zine.

```
        ┌─────────────────────────────────────────┐
        │              THE CODING DESKTOP         │
        │         a zine-style agent terminal     │
        │  ┌───────────────────────────────────┐  │
        │  │  you ▍ what time is it?           │  │
        │  │  agent ▍ (calls `now` …)          │  │
        │  │  ⇢ now ✓                          │  │
        │  │  agent ▍ 12:12 UTC …              │  │
        │  └───────────────────────────────────┘  │
        │  [ type a prompt … ]  SEND ↗  STOP      │
        └─────────────────────────────────────────┘
```

## The double loop

The agent is built on `@earendil-works/pi-agent-core`, whose `runLoop` is a double nested loop:

- **Inner loop** — stream the LLM response; if it emits tool calls, execute them and feed the results back to the model; repeat until the model stops.
- **Outer loop** — after a turn settles, drain queued *follow-up* / *steering* messages; keep running until nothing is left.

Every message you type starts a `prompt()` run. Messages typed **while the agent is busy** are queued via `followUp()` and picked up by the outer loop — watch the status bar: `RUNNING · TURN n` counts inner-loop turns, `· n queued` shows the outer loop at work.

A single tool, `now`, demonstrates the inner loop (LLM → tool → result → LLM). Ask it what time it is.

## Stack

| Layer | Choice |
|-------|--------|
| Shell | [Electrobun](https://electrobun.dev) (Bun main process + native webview) |
| Agent runtime | [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) |
| LLM layer | [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) (unified multi-provider) |
| Provider | DeepSeek (`deepseek-v4-flash`, OpenAI-completions API) |
| UI | Hand-rolled zine style: paper + ink + one risograph red, serif/mono mix, crop marks, no radius/shadow/gradient |

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
│   ├── index.ts      # window + RPC wiring
│   └── agent.ts      # pi Agent: double loop, model, tools, event bridge
├── mainview/
│   ├── index.html    # masthead, transcript, composer
│   ├── index.css     # zine style
│   └── index.ts      # RPC client + transcript rendering
└── shared/
    └── rpc.ts        # AppRPCSchema (typed requests/messages, shared both sides)
```

## Commands

| Command | What it does |
|---------|--------------|
| `bun run dev` | dev mode with hot reload |
| `bun run build` | production build |
| `bun run typecheck` | `tsc --noEmit` |

## Roadmap

- More tools + a permission prompt for them
- Conversation persistence (pi's JSONL session backend)
- Provider/model picker in the UI
- Tool-call streaming progress in the transcript
