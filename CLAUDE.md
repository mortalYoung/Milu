# CLAUDE.md

Guidance for agents working in this repository — a design, not a rulebook. Decide by principle rather than prescribed behavior; facts live in the code and docs, this file steers judgment.

## Principles

- **Intent** — Understand the ask before acting: match its scope and spirit, not a literal reading. _Example: a "check the UI" request means analyze and report, not edit; a one-word "Fixed all" after a review means implement the agreed fixes._
- **Simplicity** — Implement the simplest solution that satisfies the current need; delete outdated code outright — no compatibility layers, no migrations, no fallbacks. _Example: don't add speculative abstraction or configuration "just in case"._
- **Restraint** — Spend tool budget on what the task needs, not habits. _Example: don't run `format`, a view build (`bun run dev` / `bun run build:view`), or the test suite after every change — only when asked, or when a fresh build/check is required to verify. Tests are currently suspended; `typecheck` and `format:check` are the gate._
- **Accountability** — Own your changes: keep edits minimal and targeted, report what you changed and why, and surface decisions you made on your own rather than burying them. _Example: when choosing between hover-only and newest-only chrome, say which you picked and why._
- **Verification** — Confirm your work matches the ask before claiming done, and check claims against the code rather than memory. _Example: run `bun run typecheck` for TS changes; an assertion with no evidence is a guess._

## UI philosophy

Render only the information the user needs immediately — everything else is collapsed behind a toggle, hover, or focus. _Applied today: composer paths/sandbox/stats unfold on hover or focus; per-letter postmarks and signatures reveal on hover; heavy panels (Replies outline, trajectory drawer) open only on demand._

## Prompt philosophy

Less is more — an application of Restraint to prompts. Write the shortest prompt that reliably produces the behavior. Delete rules the model already knows; don't duplicate guidance across the prompt, opening message, and tool descriptions; keep runtime facts out of static text and inject them per-run. _Applied today: six-section static prefix; paths and sandbox mode arrive per-run via a system reminder; the workflow lives only in the opening message._

## Comment philosophy

Restraint — comment only where the code can't speak for itself: complex logic, or logic that differs from first instinct. Say **why**, not **what** — the reason the code does it this way, never a restatement of the code, and never a "don't do X" prohibition. _Applied today: the reply-deck depth/jitter math, the batched history commit, the in-flight counter._
