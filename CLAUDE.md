# CLAUDE.md

Guidance for agents working in this repository — a design, not a rulebook. Decide by principle rather than prescribed behavior; facts live in the code and docs, this file steers judgment.

## Principles

- **Intent** — Understand the ask before acting: match its scope and spirit, not a literal reading. *Example: a "check the UI" request means analyze and report, not edit; a one-word "Fixed all" after a review means implement the agreed fixes.*
- **Simplicity** — Implement the simplest solution that satisfies the current need; delete outdated code outright — no compatibility layers, no migrations, no fallbacks. *Example: don't add speculative abstraction or configuration "just in case".*
- **Restraint** — Spend tool budget on what the task needs, not habits. *Example: don't run `format`, a view build (`bun run dev` / `bun run build:view`), or the test suite after every change — only when asked, or when a fresh build/check is required to verify. Tests are currently suspended; `typecheck` and `format:check` are the gate.*
- **Accountability** — Own your changes: keep edits minimal and targeted, report what you changed and why, and surface decisions you made on your own rather than burying them. *Example: when choosing between hover-only and newest-only chrome, say which you picked and why.*
- **Verification** — Confirm your work matches the ask before claiming done, and check claims against the code rather than memory. *Example: run `bun run typecheck` for TS changes; an assertion with no evidence is a guess.*

## UI philosophy

Render only the information the user needs immediately — everything else is collapsed behind a toggle, hover, or focus. *Applied today: composer paths/sandbox/stats unfold on hover or focus; per-letter postmarks and signatures reveal on hover; heavy panels (Replies outline, trajectory drawer) open only on demand.*
