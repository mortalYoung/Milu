# LETTERS

A minimal agent-harness desktop app. The **[pi agent harness](https://pi.dev)** double loop running inside an **[Electrobun](https://electrobun.dev)** window, styled like an instant messenger.

```
        ┌─────────────────────────────────────────┐
        │                 LETTERS                 │
        │  ───────────────────────────────────────  │
        │                       set_workspace ✓    │
        │        ┌───────────────────────┐         │
        │        │ ▍                     │  21:34  │
        │        └───────────────────────┘         │
        │      ⇢ send_message · ran ✓              │
        │  AGENT: IDLE                              │
        │  ( type a prompt … )  STOP  NEW [SEND ↗] │
        └─────────────────────────────────────────┘
```

IM structure with FT editorial dressing: pink paper background
(`#FFF1E5` — the salmon-pink paper FT has printed on since 1888),
white agent cards vs dark-slate user bubbles, Newsreader serif message
text, teal status accents, flat print buttons, serif wordmark on the
pink hero strip.

## The double loop

The agent is built on `@earendil-works/pi-agent-core`, whose `runLoop` is a double nested loop:

- **Inner loop** — stream the LLM response; if it emits tool calls, execute them and feed the results back to the model; repeat until the model stops.
- **Outer loop** — after a turn settles, drain queued *follow-up* / *steering* messages; keep running until nothing is left.

Every message you type starts a `prompt()` run. Messages typed **while the agent is busy** are queued via `followUp()` and picked up by the outer loop — watch the status bar: `RUNNING · TURN n` counts inner-loop turns, `· n queued` shows the outer loop at work.

The toolset — `read`, `write`, `edit`, `bash`, `send_message`, `set_workspace` —
runs in a Bun-backed execution environment that is **permission-gated**:
the agent writes only inside its workspace/storage (reads are unrestricted
except sensitive files), bash runs under a macOS Seatbelt profile, and
wider access goes through a human-approved escalation. `send_message` is
the agent's only channel to the user; `set_workspace` pins the conversation
to a project directory.

## Stack

| Layer | Choice |
|-------|--------|
| Shell | [Electrobun](https://electrobun.dev) (Bun main process + native webview) |
| Agent runtime | [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) |
| LLM layer | [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) (unified multi-provider) |
| Provider | Any pi-ai built-in (deepseek default) — chosen in Settings with the api key |
| Sandbox | macOS Seatbelt (`sandbox-exec`), fail-closed; escalation behind a human gate |
| View | Solid + Vite + Tailwind v4, FT editorial style — pink paper `#FFF1E5`, Newsreader + Public Sans, teal accents |

## Getting started

```bash
bun install
bun run dev                      # dev mode with watch
```

Then open **Settings** (gear icon) → **Providers** to add providers (each
once, api key required at add time) and paste keys — they are stored in
`~/.config/letters/.credentials.yaml` (mode 0600) and are the only credential
source; settings.json itself never holds secrets, and saved keys are never
previewed in the UI. Settings save immediately (no Save button). No key →
the agent refuses to run with a clear error. The model per partner is picked
in the composer's model select.

## How it fits together

```
 mainview (zine UI)
   │  RPC requests: chat / stop / reset / set_sandbox_mode / sandbox_respond …
   │  RPC messages: agent_turn · agent_message · trajectory_update ·
   │       escalation_update · sandbox_mode_update …
   ▼
 src/bun/index.ts — composition root: window + RPC wiring + escalation gate
   ▼
 src/bun/core/agent.ts — the pi Agent (double loop), tools bound to the
   │                     Permission facade
   ▼
 pi-ai streamSimple → the provider chosen in Settings
```

## Project structure

```
src/
├── bun/
│   ├── index.ts        # composition root: window + RPC wiring + escalation gate
│   ├── core/           # agent runtime: agent.ts (double loop), agent-config.ts
│   │                   #   (providers/model/stream), context.ts, prompt.ts,
│   │                   #   compaction.ts, surface.ts, trajectory.ts, token-meter.ts
│   ├── permission/     # every permission decision: Permission facade, path/sensitive
│   │                   #   guards, sandbox manager + seatbelt backend, escalation rules
│   ├── persist/        # JSONL session log: store.ts, events.ts (event vocabulary)
│   ├── tools/          # execution-env.ts (Bun fs/shell, permission-gated) + tool assembly
│   ├── lib/            # ensure.ts (per-partner restore), settings.ts, partner-files.ts
│   └── partners.ts     # partner profiles (folder-safe names)
├── mainview/           # built by Vite into dist/ (git-ignored)
│   ├── index.html      # Vite entry
│   ├── index.tsx       # bootstrap: render <App/> into #app
│   ├── App.tsx         # controller: RPC wiring, app state, shell chrome
│   ├── components/ · layouts/ · pages/ · lib/
│   └── style.css       # Tailwind v4 source: FT theme + component styles
└── shared/
    ├── rpc.ts          # AppRPCSchema (typed requests/messages, shared both sides)
    └── surface.ts · trajectory.ts   # view-facing surface/trajectory types
```

## Commands

| Command | What it does |
|---------|--------------|
| `bun run dev` | Vite build, then dev mode with watch |
| `bun run dev:view` | Vite watch (rebuild the view on change) |
| `bun run build` | Vite build, then production build |
| `bun run build:view` | build the view with Vite (Solid + Tailwind) |
| `bun run test` | run the Bun test suite |
| `bun run format` | format everything with Biome |
| `bun run format:check` | verify formatting (CI-friendly) |
| `bun run typecheck` | `tsc --noEmit` |

## Roadmap

- Tool-call streaming progress in the transcript (tool calls currently render after the fact)
- Model picker (today the provider's default model is used; any catalog model can be pinned via settings)
- Network policy for the sandbox seam (file effects only today)
