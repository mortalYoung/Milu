export const SESSIONS = [
	{
		id: "landing",
		name: "Landing",
		repo: "Milu",
		worktree: false,
		when: "1d",
		preview: "Milu is an agent harness with a local core, built by",
		transcript: [
			{
				type: "item",
				id: "01a1a0b1-337b-78cd-aa6a-cd2b1b1db1ea",
				kind: "user",
				text: "What is Milu?",
				at: "Nov 3 · 17:15",
			},
			{
				type: "step",
				key: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
				rows: [
					{
						kind: "thinking",
						time: 1793697330047,
						text: 'The user asks "What is Milu?" — a simple question about the project. I should look at the repo to answer factually. Let me check README or docs.\n\nLet me look at the working directory.',
					},
				],
			},
			{
				type: "item",
				id: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
				kind: "assistant",
				text: "I'll look at the repo to answer from facts rather than assumptions.",
				at: "Nov 3 · 17:15",
				html: "<p>I'll look at the repo to answer from facts rather than assumptions.</p>\n",
				cost: 0.0005590984000000001,
			},
			{
				type: "step",
				key: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
				rows: [
					{
						kind: "tool",
						time: 1793697330047,
						name: "bash",
						arg: 'ls -la; echo "---"; cat README.md 2>/dev/null | head -100',
						result:
							'total 352\ndrwxr-xr-x@  20 user  staff     640 Nov  3 10:31 .\ndrwxr-xr-x@  61 user  staff    1952 Nov  2 17:49 ..\n-rw-r--r--@   1 user  staff     254 Oct 16 16:34 .editorconfig\ndrwxr-xr-x@  15 user  staff     480 Nov  3 17:15 .git\n-rw-r--r--@   1 user  staff     127 Oct 22 17:23 .gitignore\ndrwxr-xr-x@ 149 user  staff    4768 Nov  3 15:20 .logs\n-rw-r--r--@   1 user  staff     255 Oct 16 16:34 .oxfmtrc.json\n-rw-r--r--@   1 user  staff     464 Oct 16 16:34 .oxlintrc.json\n-rw-r--r--@   1 user  staff   14867 Nov  3 15:03 AGENTS.md\ndrwxr-xr-x@   4 user  staff     128 Oct 23 16:45 artifacts\ndrwxr-xr-x@   5 user  staff     160 Nov  3 10:35 assets\n-rw-r--r--@   1 user  staff  123152 Oct 28 15:52 bun.lock\ndrwxr-xr-x@   4 user  staff     128 Nov  3 14:52 extensions\ndrwxr-xr-x@  10 user  staff     320 Oct 20 15:12 node_modules\n-rw-r--r--@   1 user  staff     983 Nov  3 15:00 package.json\ndrwxr-xr-x@  10 user  staff     320 Oct 24 21:42 packages\n-rw-r--r--@   1 user  staff    4327 Nov  3 10:49 README.md\ndrwxr-xr-x@   7 user  staff     224 Nov  3 15:00 scripts\n-rw-r--r--@   1 user  staff     903 Oct 24 21:08 tsconfig.base.json\n-rw-r--r--@   1 user  staff      59 Oct 24 21:08 tsconfig.json\n---\n<div align="center"><a name="readme-top"></a>\n\n<img height="140" src="packages/desktop/build/icon.png" alt="Milu">\n\n<h1>Milu</h1>\n\nAn agent harness with a local core — one IPC protocol, one desktop shell.\n\nYou pick a chat. It reads files, runs commands, and replies. Everything runs on your machine:\nno account, no server of ours, no telemetry, keys and data on disk.\n\n[![][bun-shield]][bun-link]\n[![][electron-shield]][electron-link]\n[![][typescript-shield]][typescript-link]\n[![][tailwind-shield]][tailwind-link]<br/>\n[![][mcp-shield]][mcp-link]\n\n[Report Bug][github-issues-link]\n\n![](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)\n\n</div>\n\n> **Rebuild in progress.** The desktop shell runs; the web end is deferred. The previous\n> implementation — 303 commits, one package, Electrobun — is kept whole at tag `archive/v1`\n> and branch `master`.\n\n## Quick Start\n\nNo build is shipped yet; the sources are the app.\n\n### Development\n\n```bash\nbun install\nbun run dev             # Vite + Electron, main/preload bundled first\nbun run build           # renderer/dist and dist-electron\nbun run start           # Electron against the built renderer\nbun run check           # tsc + oxlint + oxfmt + the package boundaries\n```\n\nThere is no test suite by design; behavior is verified by hand.\n\n## Features\n\n- **Less is more** — keep everything just enough: a minimal prompt, a simple interface,\n  fewer tools.\n- **Optional workspace** — run a chat with no workspace at all for statistics or other\n  global work.\n- **Memory** — each chat keeps its own memory, split into facts, issues and decisions.\n  Keep talking and it grows into scenes, SOPs and a persona that sounds like you.\n- **Long-term chat** — memory and cache hits wired in, so one chat per partner always\n  works in context.\n- **Keyboard** — `⌘P` opens a palette over chats, files and access: switch chat, jump to a\n  file, or give a chat skills and MCP servers.\n- **Permission** — a hard ceiling on the agent: a seatbelt sandbox confines what it can\n  write, a wider mode needs a human to say yes, and `rm` only runs after the move to the\n  trash has failed.\n- **Local** — everything runs on your machine: no account, no server, no telemetry, and\n  your keys and data stay on disk.\n- **Everything as a log** — sessions are append-only, and every view is built from them:\n  transcript, trajectory, replies, git diff, explorer.\n\n## Why not\n\n- **Claude Code** — a nice model under a bad harness: a swollen prompt, 80% of its\n  functions useless for normal scenes, and — the important part — no source to read.\n- **Codex** — an expert at making things complex, then persuading you that\'s the point. An\n  acquired taste, apparently compulsory.\n- **Kimi Code** — a bad UI swollen with functions. Less is More? Never heard of it.\n- **ZCode** — Schrödinger\'s _open-source_: you can\'t tell without opening the box — and GLM\n  is in there either way.\n- **dsh** — DeepSeek Harness: a talented harness — just don\'t hand it to a non-programmer.\n\n---\n\n<div align="center">\n\n**Built on** — [pi](https://pi.dev) · [pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core) · [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) · [Electron](https://www.electronjs.org) · [MCP](https://modelcontextprotocol.io) · [Shiki](https://shiki.style/)\n\n<sub>Made with a fountain pen.</sub>\n\n</div>\n\n[github-issues-link]: https://github.com/mortalYoung/Milu/issues\n[bun-shield]: https://img.shields.io/badge/Bun-1.4-fbf0df?labelColor=black&logo=bun&logoColor=white&style=flat-square\n[bun-link]: https://bun.sh\n[electron-shield]: https://img.shields.io/badge/Electron-44-2f6f9f?labelColor=black&logo=electron&logoColor=white&style=flat-square\n[electron-link]: https://www.electronjs.org\n[typescript-shield]: https://img.shields.io/badge/TypeScript-7-3178c6?labelColor=black&logo=typescript&logoColor=white&style=flat-square\n[typescript-link]: https://www.typescriptlang.org\n[tailwind-shield]: https://img.shields.io/badge/Tailwind-v4-38bdf8?labelColor=black&logo=tailwindcss&logoColor=white&style=flat-square\n[tailwind-link]: https://tailwindcss.com\n[mcp-shield]: https://img.shields.io/badge/MCP-stdio-2f6f9f?labelColor=black&style=flat-square\n[mcp-link]: https://modelcontextprotocol.io\n',
						status: "success",
					},
					{
						kind: "tool",
						time: 1793697330047,
						name: "bash",
						arg: 'cat package.json 2>/dev/null; echo "---"; ls packages docs 2>/dev/null',
						result:
							'{\n\t"name": "milu",\n\t"version": "0.0.0",\n\t"private": true,\n\t"description": "An agent harness — a local core behind one IPC protocol, rendered by a desktop shell",\n\t"workspaces": [\n\t\t"packages/*"\n\t],\n\t"type": "module",\n\t"scripts": {\n\t\t"boundaries": "bun scripts/boundaries.ts",\n\t\t"build": "bun run --filter \'@milu/desktop\' build",\n\t\t"check": "bun run typecheck && bun run lint && bun run format:check && bun run boundaries",\n\t\t"dev": "bun scripts/dev.ts",\n\t\t"ext:build": "bun scripts/ext-build.ts",\n\t\t"ext:install": "bun run ext:build && bun scripts/ext-install.ts",\n\t\t"format": "oxfmt",\n\t\t"format:check": "oxfmt --check",\n\t\t"lint": "oxlint",\n\t\t"lint:fix": "oxlint --fix",\n\t\t"release": "bun scripts/release.ts",\n\t\t"start": "bun run --filter \'@milu/desktop\' start",\n\t\t"typecheck": "bun run --filter \'*\' typecheck"\n\t},\n\t"devDependencies": {\n\t\t"@types/bun": "latest",\n\t\t"oxfmt": "^0.73.0",\n\t\t"oxlint": "^1.88.0",\n\t\t"typescript": "^7.0.2"\n\t},\n\t"trustedDependencies": [\n\t\t"electron"\n\t]\n}\n---\npackages:\nbootstrap\ncore\ndesktop\ndi\nextension-types\nextensions\nprotocol\nwindow\n\n\nCommand exited with code 1',
						status: "success",
					},
					{
						kind: "thinking",
						time: 1793697331268,
						text: "The user asks a simple factual question about what Milu is. I've read the README. I can answer concisely. Maybe also check AGENTS.md exists (already have it in system reminder). Answer directly, no need for more tool calls.\n\nKeep it short and useful.",
					},
				],
			},
			{
				type: "item",
				id: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
				kind: "assistant",
				text: "**Milu** is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.\n\nThe essentials from the repo:\n\n- **Shape** — `packages/core` is the domain, runtime-neutral (no Electron, no DOM, no sockets, no Bun-only APIs). One transport — Electron IPC — and one desktop shell renders it. `packages/bootstrap` is the only place that assembles the containers; `packages/desktop` is the only place that imports Electron.\n- **Workflow** — you pick a chat; `⌘P` opens a palette over chats, files and access. A chat can run with no workspace at all.\n- **Memory** — per-chat memory split into facts, issues and decisions, growing into scenes, SOPs and a persona.\n- **Permission** — a seatbelt sandbox as a hard ceiling; a wider mode needs a human yes; `rm` only after a move to trash has failed.\n- **Everything as a log** — append-only sessions; transcript, trajectory, replies, git diff and explorer are all views over them.\n- **Stack** — Bun, Electron, TypeScript, Tailwind v4, React, on top of `pi` / `pi-agent-core` / `pi-ai` and MCP.\n\nTwo things worth flagging as context:\n\n1. **It's mid-rebuild.** The desktop shell runs; the web end is deferred. The previous implementation (303 commits, single package, Electrobun) is kept whole at tag `archive/v1` and branch `master` — read-only reference, still holding `assets/` and `.agents/` to bring forward.\n2. **It's opinionated by design.** \"Less is more\": minimal prompt, simple interface, fewer tools. Single user, no auth, no test suite — behavior is verified by hand, and `bun run check` (tsc + oxlint + oxfmt + package boundaries) is the gate.\n\nThe philosophical position is in the README's *Why not* section: Milu exists as a reaction to harnesses that are swollen, closed-source, or hostile to non-programmers.",
				at: "Nov 3 · 17:15",
				html: "<p><strong>Milu</strong> is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.</p>\n<p>The essentials from the repo:</p>\n<ul>\n<li><strong>Shape</strong> — <code>packages/core</code> is the domain, runtime-neutral (no Electron, no DOM, no sockets, no Bun-only APIs). One transport — Electron IPC — and one desktop shell renders it. <code>packages/bootstrap</code> is the only place that assembles the containers; <code>packages/desktop</code> is the only place that imports Electron.</li>\n<li><strong>Workflow</strong> — you pick a chat; <code>⌘P</code> opens a palette over chats, files and access. A chat can run with no workspace at all.</li>\n<li><strong>Memory</strong> — per-chat memory split into facts, issues and decisions, growing into scenes, SOPs and a persona.</li>\n<li><strong>Permission</strong> — a seatbelt sandbox as a hard ceiling; a wider mode needs a human yes; <code>rm</code> only after a move to trash has failed.</li>\n<li><strong>Everything as a log</strong> — append-only sessions; transcript, trajectory, replies, git diff and explorer are all views over them.</li>\n<li><strong>Stack</strong> — Bun, Electron, TypeScript, Tailwind v4, React, on top of <code>pi</code> / <code>pi-agent-core</code> / <code>pi-ai</code> and MCP.</li>\n</ul>\n<p>Two things worth flagging as context:</p>\n<ol>\n<li><strong>It's mid-rebuild.</strong> The desktop shell runs; the web end is deferred. The previous implementation (303 commits, single package, Electrobun) is kept whole at tag <code>archive/v1</code> and branch <code>master</code> — read-only reference, still holding <code>assets/</code> and <code>.agents/</code> to bring forward.</li>\n<li><strong>It's opinionated by design.</strong> &quot;Less is more&quot;: minimal prompt, simple interface, fewer tools. Single user, no auth, no test suite — behavior is verified by hand, and <code>bun run check</code> (tsc + oxlint + oxfmt + package boundaries) is the gate.</li>\n</ol>\n<p>The philosophical position is in the README's <em>Why not</em> section: Milu exists as a reaction to harnesses that are swollen, closed-source, or hostile to non-programmers.</p>\n",
				cost: 0.0009884784000000002,
			},
		],
		panes: {
			replies: [
				{
					id: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
					question: "What is Milu?",
					questionId: "01a1a0b1-337b-78cd-aa6a-cd2b1b1db1ea",
					text: "**Milu** is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.\n\nThe essentials from the repo:\n\n- **Shape** — `packages/core` is the domain, runtime-neutral (no Electron, no DOM, no sockets, no Bun-only APIs). One transport — Electron IPC — and one desktop shell renders it. `packages/bootstrap` is the only place that assembles the containers; `packages/desktop` is the only place that imports Electron.\n- **Workflow** — you pick a chat; `⌘P` opens a palette over chats, files and access. A chat can run with no workspace at all.\n- **Memory** — per-chat memory split into facts, issues and decisions, growing into scenes, SOPs and a persona.\n- **Permission** — a seatbelt sandbox as a hard ceiling; a wider mode needs a human yes; `rm` only after a move to trash has failed.\n- **Everything as a log** — append-only sessions; transcript, trajectory, replies, git diff and explorer are all views over them.\n- **Stack** — Bun, Electron, TypeScript, Tailwind v4, React, on top of `pi` / `pi-agent-core` / `pi-ai` and MCP.\n\nTwo things worth flagging as context:\n\n1. **It's mid-rebuild.** The desktop shell runs; the web end is deferred. The previous implementation (303 commits, single package, Electrobun) is kept whole at tag `archive/v1` and branch `master` — read-only reference, still holding `assets/` and `.agents/` to bring forward.\n2. **It's opinionated by design.** \"Less is more\": minimal prompt, simple interface, fewer tools. Single user, no auth, no test suite — behavior is verified by hand, and `bun run check` (tsc + oxlint + oxfmt + package boundaries) is the gate.\n\nThe philosophical position is in the README's *Why not* section: Milu exists as a reaction to harnesses that are swollen, closed-source, or hostile to non-programmers.",
					at: "NOV 3 · 17:15",
					count: 2,
				},
			],
			trajectory: {
				origin: {
					rows: [
						{
							key: "01a1a0b1-3375-7c7b-80ae-cd6c799a5cad:0",
							entryId: "01a1a0b1-3375-7c7b-80ae-cd6c799a5cad",
							stamp: "2026-11-03 17:15:30",
							chip: "SYS",
							tone: "system",
							caption: "System prompt",
							details: [
								{
									content: {
										kind: "code",
										value:
											"# IDENTIFY\nYou are a helpful software engineer assistant.\n\n# WORKING DIRECTORY\nWhen a working directory is set, relative paths you pass to read/write/edit/bash resolve against it, and bash starts there. When it is not set, bash runs in your storage scratch directory and file tools require absolute paths. Sensitive files (e.g. .env, private keys) are off-limits in the working directory; use the storage path for those.\n\n# STORAGE\nYour storage path is your own directory. Full access, including sensitive files. Keep temporary artifacts, notes, and summaries here — never in the working directory or the user's project.",
									},
								},
							],
							runStart: true,
						},
						{
							key: "01a1a0b1-3379-7eb6-ab20-b3af7d8fa56e:0",
							entryId: "01a1a0b1-3379-7eb6-ab20-b3af7d8fa56e",
							stamp: "2026-11-03 17:15:30",
							chip: "HDR",
							tone: "request",
							caption: "worktrees, read, write, edit, bash, task, rm, mcp, schedule, peer, web_fetch, skill, memory · 13 tools",
							details: [
								{
									label: "worktrees",
									description:
										"Work with git worktrees of this chat's repository.\n- list: every worktree, with its branch and path, marking the one containing the current workspace.\n- create: add a worktree at path on branch, from base (default HEAD); path and branch are required. It does not attach the new worktree to this chat.\n- switch: attach this chat's workspace to an existing worktree path.\n- delete: remove the worktree at path; dirty worktrees are refused, the branch is left in place, and the current worktree cannot be deleted.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "op"\n  ],\n  "properties": {\n    "op": {\n      "anyOf": [\n        {\n          "type": "string",\n          "const": "list"\n        },\n        {\n          "type": "string",\n          "const": "create"\n        },\n        {\n          "type": "string",\n          "const": "switch"\n        },\n        {\n          "type": "string",\n          "const": "delete"\n        }\n      ],\n      "description": "What to do: list this repository\'s worktrees, create one, switch this chat to one, or delete one."\n    },\n    "path": {\n      "type": "string",\n      "description": "create: the new worktree path; switch/delete: an existing worktree path."\n    },\n    "branch": {\n      "type": "string",\n      "description": "create: the branch to check out; required."\n    },\n    "base": {\n      "type": "string",\n      "description": "create: the commit or branch a new branch starts from; defaults to HEAD."\n    }\n  }\n}',
									},
								},
								{
									label: "read",
									description:
										"Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "path"\n  ],\n  "properties": {\n    "path": {\n      "type": "string",\n      "description": "Path to the file to read (relative or absolute)"\n    },\n    "offset": {\n      "type": "number",\n      "description": "Line number to start reading from (1-indexed)"\n    },\n    "limit": {\n      "type": "number",\n      "description": "Maximum number of lines to read"\n    }\n  }\n}',
									},
								},
								{
									label: "write",
									description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "path",\n    "content"\n  ],\n  "properties": {\n    "path": {\n      "type": "string",\n      "description": "Path to the file to write (relative or absolute)"\n    },\n    "content": {\n      "type": "string",\n      "description": "Content to write to the file"\n    }\n  }\n}',
									},
								},
								{
									label: "edit",
									description:
										"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "path",\n    "edits"\n  ],\n  "properties": {\n    "path": {\n      "type": "string",\n      "description": "Path to the file to edit (relative or absolute)"\n    },\n    "edits": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "required": [\n          "oldText",\n          "newText"\n        ],\n        "properties": {\n          "oldText": {\n            "type": "string",\n            "description": "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."\n          },\n          "newText": {\n            "type": "string",\n            "description": "Replacement text for this targeted edit."\n          }\n        }\n      },\n      "description": "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead."\n    }\n  }\n}',
									},
								},
								{
									label: "bash",
									description:
										"Execute a bash command. Runs in the working directory when one is set, otherwise in the storage scratch directory. Returns stdout and stderr (last ~50KB, truncated).",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "command"\n  ],\n  "properties": {\n    "command": {\n      "type": "string",\n      "description": "Bash command to execute"\n    },\n    "timeout": {\n      "type": "number",\n      "description": "Timeout in seconds for this call; defaults to the bash timeout setting."\n    },\n    "sandbox_mode": {\n      "anyOf": [\n        {\n          "type": "string",\n          "const": "read-only"\n        },\n        {\n          "type": "string",\n          "const": "workspace-write"\n        },\n        {\n          "type": "string",\n          "const": "danger-full-access"\n        }\n      ],\n      "description": "Request a strictly wider sandbox mode for THIS call only (one retry per turn; human approval required)."\n    },\n    "justification": {\n      "type": "string",\n      "description": "Required when sandbox_mode is set: why the wider permission is needed."\n    },\n    "background": {\n      "type": "boolean",\n      "description": "Run it detached and return a task id immediately, without waiting. Use for servers, watchers, or anything that doesn\'t exit on its own; also for a long job you\'d rather not block on. Not compatible with timeout. Read its output with the task tool (op: \\"read\\"); to be notified when it ends, call the task tool (op: \\"subscribe\\")."\n    }\n  }\n}',
									},
								},
								{
									label: "task",
									description:
										"Inspect or stop a background task started by bash with background: true.\n- read: the last lines of its output, plus its status and exit code.\n- subscribe: get a follow-up message when the task ends (once). If it is still running after `remind_after` seconds you also get one reminder; the task keeps running.\n- stop: kill the task's process group.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "op",\n    "id"\n  ],\n  "properties": {\n    "op": {\n      "anyOf": [\n        {\n          "type": "string",\n          "const": "read"\n        },\n        {\n          "type": "string",\n          "const": "subscribe"\n        },\n        {\n          "type": "string",\n          "const": "stop"\n        }\n      ],\n      "description": "What to do with the task: \\"read\\" its output tail, \\"subscribe\\" to be notified when it ends, or \\"stop\\" it."\n    },\n    "id": {\n      "type": "string",\n      "description": "Task id returned by bash with background: true."\n    },\n    "lines": {\n      "type": "number",\n      "description": "read: how many tail lines to return. Defaults to 200."\n    },\n    "remind_after": {\n      "type": "number",\n      "description": "subscribe: seconds until a one-off reminder that the task is still running. Defaults to 180. Does not kill the task."\n    }\n  }\n}',
									},
								},
								{
									label: "rm",
									description:
										"Irreversibly delete files and directories — no trash, no undo. This is the fallback for when moving a path to the trash did not work (disk full, file too large, permissions). It only runs after a bash call has failed while moving those paths into the trash, and refuses otherwise. For a recoverable delete, use bash instead: `mv <path> ~/.Trash/`.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "paths",\n    "dir"\n  ],\n  "properties": {\n    "paths": {\n      "type": "array",\n      "items": {\n        "type": "string"\n      },\n      "description": "Files or directories to delete. Absolute, or relative to the working directory."\n    },\n    "dir": {\n      "type": "boolean",\n      "description": "True when these paths are directories. A mismatch with the filesystem is refused."\n    }\n  }\n}',
									},
								},
								{
									label: "mcp",
									description:
										"Work with MCP servers authorized for this session. `list` shows each server with the tools it exposes; `call` runs one tool on one server. Run `list` first to discover names.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "op"\n  ],\n  "properties": {\n    "op": {\n      "anyOf": [\n        {\n          "type": "string",\n          "const": "list"\n        },\n        {\n          "type": "string",\n          "const": "call"\n        }\n      ],\n      "description": "What to do: \\"list\\" the authorized servers and their tools, or \\"call\\" one tool."\n    },\n    "server": {\n      "type": "string",\n      "description": "call: MCP server name (from list)."\n    },\n    "tool": {\n      "type": "string",\n      "description": "call: tool name on that server (from list)."\n    },\n    "arguments": {\n      "type": "object",\n      "patternProperties": {\n        "^.*$": {}\n      },\n      "description": "call: tool arguments."\n    }\n  }\n}',
									},
								},
								{
									label: "schedule",
									description:
										"Put work on a clock for this chat, or see what is already on it.\n- list: every schedule on this chat, with its next run and how many times it has fired.\n- create: one new schedule. It runs as a message to this chat, in this workspace, with the permission mode in force at that moment.\n- run: send one now instead of waiting for the clock. Only an active schedule runs; its next fire does not move and the run does not count against the daily cap.\nMilu only runs while it is open: a fire that comes due while the app is closed is missed, not queued up (a repeating one runs at most once on restart; a fixed-time one is skipped).\nAsk first when the user has not asked for this themselves.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "op"\n  ],\n  "properties": {\n    "op": {\n      "anyOf": [\n        {\n          "type": "string",\n          "const": "list"\n        },\n        {\n          "type": "string",\n          "const": "create"\n        },\n        {\n          "type": "string",\n          "const": "run"\n        }\n      ],\n      "description": "What to do: \\"list\\" the schedules on this chat, \\"create\\" a new one, or \\"run\\" one now."\n    },\n    "when": {\n      "type": "string",\n      "description": "create: the clock, as a 5-field cron expression in local time — minute hour day-of-month month day-of-week. Examples: \\"30 10 * * *\\" (every day at 10:30), \\"*/15 * * * *\\" (every 15 minutes), \\"30 17 * * 5\\" (Fridays 17:30). A cron clock repeats: there is no one-shot form, and anything faster than every 15 minutes is refused."\n    },\n    "text": {\n      "type": "string",\n      "description": "create: what this chat should do when it fires, written as the message it will receive."\n    },\n    "title": {\n      "type": "string",\n      "description": "create: a short label a human will read in the schedule list. Defaults to the clock itself."\n    },\n    "id": {\n      "type": "string",\n      "description": "run: the schedule id, as it appears at the start of a list line — e.g. \\"s1a2b3\\"."\n    }\n  }\n}',
									},
								},
								{
									label: "peer",
									description:
										"Write to another chat. It is a separate correspondent with its own workspace, persona and tools: it decides whether and how to reply, and a reply may arrive later as a new message. Sending does not end your turn; never write the reply yourself.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "op"\n  ],\n  "properties": {\n    "op": {\n      "anyOf": [\n        {\n          "type": "string",\n          "const": "list"\n        },\n        {\n          "type": "string",\n          "const": "send"\n        }\n      ],\n      "description": "What to do: \\"list\\" the chats you can write to, or \\"send\\" one of them a message."\n    },\n    "peer": {\n      "type": "string",\n      "description": "send: the chat to write to (a name from list)"\n    },\n    "text": {\n      "type": "string",\n      "description": "send: the message. A reply may arrive later as a new message."\n    }\n  }\n}',
									},
								},
								{
									label: "web_fetch",
									description:
										"Fetch an HTTP(S) URL and return its content as readable text (HTML is converted to plain text). Applies timeout and size limits; the content is external and untrusted.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "url"\n  ],\n  "properties": {\n    "url": {\n      "type": "string",\n      "description": "Absolute HTTP(S) URL to fetch and read as text."\n    }\n  }\n}',
									},
								},
								{
									label: "skill",
									description:
										"Load a skill's full instructions by its exact name from the <available_skills> catalog. Use it when a task matches one of the listed skills before or while doing the work.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "required": [\n    "name"\n  ],\n  "properties": {\n    "name": {\n      "type": "string",\n      "description": "Kebab-case skill name to load, exactly as listed in <available_skills>."\n    }\n  }\n}',
									},
								},
								{
									label: "memory",
									description:
										"Read durable memories for this partner. Use it when a task depends on prior project facts, decisions, issues, references, preferences, instructions, or objective user-driven events. Matches are ranked by relevance when a query is given (newest first otherwise); superseded entries are hidden unless includeSuperseded is true. Long detail is truncated and large result sets are capped by an output budget.",
									meta: [],
									content: {
										kind: "json",
										value:
											'{\n  "type": "object",\n  "properties": {\n    "query": {\n      "type": "string",\n      "description": "read: keywords matched against memory text, split on spaces, `|`, `,`, `/`; the whole query is also matched as a regex"\n    },\n    "kinds": {\n      "type": "array",\n      "items": {\n        "anyOf": [\n          {\n            "type": "string",\n            "const": "fact"\n          },\n          {\n            "type": "string",\n            "const": "decision"\n          },\n          {\n            "type": "string",\n            "const": "issue"\n          },\n          {\n            "type": "string",\n            "const": "reference"\n          },\n          {\n            "type": "string",\n            "const": "event"\n          },\n          {\n            "type": "string",\n            "const": "preference"\n          },\n          {\n            "type": "string",\n            "const": "instruction"\n          }\n        ]\n      },\n      "description": "read: only return these kinds"\n    },\n    "limit": {\n      "type": "integer",\n      "description": "read: maximum memories to return (default 20)"\n    },\n    "includeSuperseded": {\n      "type": "boolean",\n      "description": "read: include memories that have been superseded (default false)"\n    }\n  }\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3378-7a91-9f91-7ae7046871f4:0",
							entryId: "01a1a0b1-3378-7a91-9f91-7ae7046871f4",
							stamp: "2026-11-03 17:15:30",
							chip: "RUN",
							tone: "change",
							caption: "run 1",
							details: [
								{
									content: {
										kind: "json",
										value: '{\n  "run": 1,\n  "timestamp": 1793697330040\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-337b-78cd-aa6a-cd2b1b1db1ea:0",
							entryId: "01a1a0b1-337b-78cd-aa6a-cd2b1b1db1ea",
							stamp: "2026-11-03 17:15:30",
							chip: "Q",
							tone: "user",
							caption: "What is Milu?",
							details: [
								{
									content: {
										kind: "text",
										value: "What is Milu?",
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-337e-7e84-91a4-07b70d28512c:0",
							entryId: "01a1a0b1-337e-7e84-91a4-07b70d28512c",
							stamp: "2026-11-03 17:15:30",
							chip: "CTX",
							tone: "reminder",
							caption: "~/Projects/Milu",
							details: [
								{
									content: {
										kind: "json",
										value:
											'{\n  "workspace": "~/Projects/Milu",\n  "storage": "~/partners/Landing/storage",\n  "sandbox": "workspace-write",\n  "skills": [],\n  "timestamp": 1793697330046\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3381-7b94-8fda-f74ac2c5d588:0",
							entryId: "01a1a0b1-3381-7b94-8fda-f74ac2c5d588",
							stamp: "2026-11-03 17:15:30",
							chip: "INS",
							tone: "reminder",
							caption: "instructions/changed",
							details: [
								{
									content: {
										kind: "json",
										value:
											'{\n  "agentMd": "# AGENTS.md\\n\\nGuidance for agents working in this repository — a design, not a rulebook. Decide by principle rather than prescribed behavior; facts live in the code and docs, this file steers judgment.\\n\\n## Principles\\n\\n- **Intent** — Understand the ask before acting: match its scope and spirit, not a literal reading. _Example: a \\"check the UI\\" request means analyze and report, not edit; a one-word \\"Fixed all\\" after a review means implement the agreed fixes._\\n- **Simplicity** — Implement the simplest solution that satisfies the current need; delete outdated code outright — no compatibility layers, no migrations, no fallbacks. _Example: this repo is greenfield. There is no legacy data and no released version, so nothing needs to keep working; delete freely._\\n- **Restraint** — Spend tool budget on what the task needs, not habits. _Example: don\'t run `format` or rebuild the view after every change — only when asked, or when a fresh check is required to verify. There is no test suite by design; `bun run typecheck`, `bun run lint` and `bun run format:check` are the gate, and the user verifies behavior._\\n- **Accountability** — Own your changes: keep edits minimal and targeted, report what you changed and why, and surface decisions you made on your own rather than burying them. **Never commit unless the user asks in that message** — land the change in the working tree and report it; the user writes the history.\\n- **Verification** — Confirm your work matches the ask before claiming done, and check claims against the code rather than memory. _Example: run `bun run typecheck` for TS changes; an assertion with no evidence is a guess._\\n\\n## Architecture\\n\\nThe rebuild exists to enforce these rules. Break one and the reason for the rebuild is gone.\\n\\n- **The core does not know how it is reached.** `packages/core` never imports Electron, never opens a socket, never touches `DOM`. It emits typed events and returns values; a transport adapter at the edge decides who hears about it. No `rpc.send.*` anywhere inside the domain.\\n- **The core is runtime-neutral.** It runs in Electron\'s main process today, and could move to a utility process or another shell tomorrow without changing a line. So no Electron, DOM or Bun-only API — `Bun.serve`, `Bun.file`, `bun:sqlite` — and no Bun-shaped types. v1 already satisfies this: it imports only `node:*`, and `pi-agent-core` declares `node >=22`. Keep it that way.\\n- **A service declares its dependencies; the container builds it.** Services are identified by tokens (`ISessionService`), registered into a `ServiceCollection` as instances, factories or `SyncDescriptor`s, and built by `InstantiationService.createInstance`, which resolves the constructor parameters decorated with a token (`@ISessionService`) plus whatever static arguments the descriptor carries. Bun only applies parameter decorators when a `tsconfig.json` with `experimentalDecorators` is visible from the working directory, so `assertDependencies` turns a dropped decorator into a startup error instead of `undefined` fields.\\n- **A singleton is unique to its container, never to the module.** `export const foo = new Foo()` is the v1 mistake wearing a better name — same implicit ordering, same untestable coupling, and it _looks_ clean, so nobody revisits it. The container is the only global.\\n- **State has one owner and an explicit lifecycle.** One service owns each piece of mutable state, and it says out loud how it starts and how it stops (`create → initialize → dispose`). Watchers, timers, `AbortController`s and child processes are all disposed by their owner. v1 leaked every one of these.\\n- **Only state earns a service.** A pure function is a function. Wrapping `fuzzy`, `trajectory`, `token-meter` in a class adds a layer and buys nothing.\\n- **An extension declares its window widgets.** `widgets: [{ id, type, entry, export? }]` on the extension: `type` picks the registry (`slot` / `widget` / `dialog` / `trigger` / `service`), `entry` names the module relative to the extension root, `export` defaults to `default`. The window asks the backend for that list (`widgets`) and imports every entry from the URL it comes back with — a hashed chunk emitted from `widgets.json` for builtins, the package file for a disk extension — so the shell imports no extension code and holds no map of them. Loading happens before the container boots, so a widget may also be a front-end service. A packaged widget receives `{ id, data }` and nothing else: the rest of its surface is `useWidget`, `useSession`, `useCommand` and `useExtensionData(key)` from `globalThis.miluHost.api`, plus React from `globalThis.miluHost.react` — a packaged chunk cannot resolve a bare specifier, so the bridge is the only import it has. Builtin widgets keep the whole `Host` on purpose: they are the shell\'s own chrome. Which shape a widget gets is decided by its `source`, never mixed, and every packaged widget sits inside a boundary that renders a failure line instead of taking the tree down.\\n- **An extension may register a theme.** A theme is one appearance (`light` or `dark`) plus a partial map of the documented tokens; the core registry validates the id and token names, and the window applies the tokens inline over the built-in palette. `settings.theme` is `{ mode, light, dark }`: the mode decides which side is active, the two slots decide which theme each side uses, and a missing theme falls back to the built-in `light`/`dark`.\\n- **A packaged extension is a manifest plus a module.** `package.json` carries `milu.apiVersion`, `milu.widgets`, `milu.contributions` and `milu.services`; the host reads and validates that JSON and never imports the module. Activation is handed to a `utilityProcess` speaking the protocol in `core/src/extensions/host.ts`, and every tool the child registers becomes a host-side proxy. The child sees only the capability surface — `tools.register`, `actions.register`, `hooks.on`, `settings.declare`, `themes.register`, `disposables`, plus a few names the host declares in `CapabilityService` as `core.*` and the child reaches as `context.services.get(\\"core.provider\\")`. A capability is a verb the host performs, never a handle it hands over: arguments and results must survive `structuredClone` (checked in the host), and the API key stays here — the host fetches the balance and hands back the number. Never a live service; a host that exits is restarted (three attempts, then its registrations are torn down and the failure is recorded); `settingsChanged` keeps a declared point in the child in step with `settings.update`, and a manifest item whose `data` reads `{ \\"from\\": \\"extension\\", \\"key\\": … }` is resolved by asking the child for that key when the slot is read; without a host process a packaged extension fails loudly instead of running in the host.\\n- **An extension may declare DI services.** `{ id: ServiceId, create }` declarations are registered before boot, on either end — core through `declareExtensionServices`, the window through a window module\'s `services` export. The name carries the extension (`replies.state`), the container owns the lifecycle, and runtime registration stays closed, so a module-level singleton is still a bug.\\n- **An extension may expose a service across the process boundary.** `milu.services` in the manifest names `<extension>.<name>` plus its methods; the owner implements them in its own process and any caller reaches them by name — `context.services.get(\\"acme.math\\").double(21)` — because a token is an object and objects do not cross. A service here is a method contract, not an object: calls are async, arguments and results must survive `structuredClone` (checked in the host, before the reply leaves), an unknown method names the service and the method, and an owner that is not running fails fast instead of queueing. The proxy re-resolves the owner on every call, so a restarted extension is invisible to callers. Never call another extension\'s service from your own `activate` — boot order is not a promise; call where the work happens. In v1 any extension may call any declared service; that is the local-install trust model, not an oversight.\\n- **Permission must never degrade silently.** v1\'s sandbox chain is empty on anything but macOS, so the gate quietly disappears. A missing sandbox is a hard failure, never a fallback.\\n\\n## Packages\\n\\n| Package                    | May depend on                                              | Never                                    |\\n| -------------------------- | ---------------------------------------------------------- | ---------------------------------------- |\\n| `packages/protocol`        | nothing                                                    | any runtime                              |\\n| `packages/di`              | nothing                                                    | any runtime                              |\\n| `packages/extension-types` | `protocol`, the agent\'s tool types                         | any runtime                              |\\n| `packages/core`            | `protocol`, `di`, `extension-types`                        | Electron, DOM, sockets, Bun-only         |\\n| `packages/window`          | `di`, `protocol`, React, `zustand`, `markdown-it`, `shiki` | Electron, `core`, an extension, a shell  |\\n| `packages/extensions`      | `core`, `di`, `protocol`, `window`, React                  | Electron, `bootstrap`, the desktop shell |\\n| `packages/bootstrap`       | `core`, `extensions`, `window`, `di`                       | Electron, `desktop`                      |\\n| `packages/desktop`         | `core`, `protocol`, `bootstrap`, `extensions`, `window`    | —                                        |\\n\\n`packages/extensions` is the extension set — one folder per extension, nothing else: the window runtime lives in `packages/window`, the host protocol in `core`.\\n\\n`packages/protocol` and `packages/extension-types` are the published surface: they export `src/index.ts` in the workspace and `dist/` from a staged copy. `bun run release` builds both into `artifacts/<package>`, rewrites `workspace:` ranges, and prints the publish command; the workspace manifests stay `private` so nothing can publish them half-built.\\n\\n`packages/bootstrap` is the only place that assembles: `createBackend` for the core container, `createFrontEnd` for the window container. Everything else exports, nothing else composes.\\n\\n`packages/desktop` is the only place allowed to import Electron. Its main process boots the core and owns the IPC edge; its renderer is the React app, loaded from `milu://app/index.html` through a registered custom protocol. Make the boundary a build error, not a convention.\\n\\nBooting the core in-process is what makes the desktop cheap: Electron\'s main process _is_ Node, so `desktop/main.ts` calls `createBackend` and answers the renderer over preload IPC. Splitting the core into a utility process later is a process-boundary change, not a code change — that is the point of runtime neutrality.\\n\\n## Settled decisions\\n\\nDo not re-open these without the user saying so.\\n\\n1. **Single user.** No multi-tenancy, no auth system.\\n2. **One transport: Electron IPC.** Requests are `ipcRenderer.invoke(\\"milu:request\\", method, params)`; events are `webContents.send(\\"milu:event\\", ...)`; the renderer\'s `Transport` port is the only thing that knows the channel names. `Methods` is the only registry. No HTTP server, no WebSocket, no `BrowserView.defineRPC`.\\n3. **Desktop is one app.** Electron\'s main process boots the core in-process; the renderer loads from `milu://app/index.html` through a custom protocol (with a CSP) and talks over a preload bridge with `contextIsolation` and `sandbox`. No port, no token, no network surface. A web end would be another `Transport` adapter later, not another app.\\n4. **Behavior over tests.** No test suite. The user verifies.\\n\\n## v1 is a read-only reference\\n\\nThe previous implementation (303 commits, single package) is tag `archive/v1` and branch `master`. Read it, don\'t edit it — a reference that moves is no longer a reference.\\n\\n```bash\\ngit checkout archive/v1 -- <path>       # pull one file or directory forward\\ngit show archive/v1:src/bun/index.ts    # read without touching the worktree\\n```\\n\\nStill to bring forward: `assets/` (icon, wordmark, `gen-icons.sh`) and `.agents/` + `skills-lock.json` (the `qiaomu-design` skill — it exists nowhere else).\\n\\n## UI philosophy\\n\\nRender only the information the user needs immediately — everything else is collapsed behind a toggle, hover, or focus.\\n\\n## Extension styling\\n\\nAn extension renders inside the host\'s DOM and inherits the host\'s CSS. Only the rows the host\'s Tailwind build emitted exist, and `@source` names only our own sources — so a builtin widget\'s utilities (including arbitrary values) make it into the sheet, while a packaged widget\'s do not.\\n\\n- **Tokens are the contract.** Base variables carry light and dark through `light-dark()`, so `var(--ink)`, `var(--ink-soft)`, `var(--muted)`, `var(--muted-soft)`, `var(--line)`, `var(--line-strong)`, `var(--surface)`, `var(--chrome)`, `var(--canvas)`, `var(--signal)`, `var(--link)`, `var(--hover)`, `var(--selected)`, `var(--caption)`, `var(--accent-teal)`, `var(--accent-amber)`, `var(--code-bg)`, `var(--code-block-bg)` and `var(--code-hairline)` follow the theme without knowing about it. There is no `--line-soft`: the softer hairline is `var(--color-line-soft)` (a `color-mix` of `--line`).\\n- **Owning CSS is allowed, scoped.** A packaged widget may ship its own stylesheet, served from its package; every selector is namespaced under `.milu-ext-<id>` so two extensions cannot collide.\\n- **Utility class names are not an API.** `bar-icon`, `welcome-btn` and friends are internal to the shell; a widget that copies them breaks silently on the next redesign. The same goes for every utility class in a packaged widget: the host\'s sheet never generated it.\\n\\n## Prompt philosophy\\n\\nLess is more — an application of Restraint to prompts. Write the shortest prompt that reliably produces the behavior. Delete rules the model already knows; don\'t duplicate guidance across the prompt, opening message, and tool descriptions; keep runtime facts out of static text and inject them per-run.\\n\\n## Comment philosophy\\n\\nNo explanatory comments unless the user explicitly asks for one. Code should speak for itself — prefer clear names and structure over explanatory comments. If a comment seems necessary, the code likely isn\'t clear enough; improve the code instead.\\n\\nThe one allowed exception is **region-marker comments**: a short banner that labels a section inside a long composition function or controller (for example `// ——— feature controllers ———`). Region markers are structural, not explanatory, and should be the only comments added freely.\\n",\n  "timestamp": 1793697330046\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3823-7131-8fb4-a71f241bb665:0",
							entryId: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
							stamp: "2026-11-03 17:15:31",
							chip: "THINK",
							tone: "plain",
							caption: 'The user asks "What is Milu?" — a simple question about the project. I should look at the repo to answer factually. Let me check README or docs.',
							details: [
								{
									content: {
										kind: "text",
										value:
											'The user asks "What is Milu?" — a simple question about the project. I should look at the repo to answer factually. Let me check README or docs.\n\nLet me look at the working directory.',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3823-7131-8fb4-a71f241bb665:1",
							entryId: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
							stamp: "2026-11-03 17:15:31",
							chip: "MSG",
							tone: "plain",
							caption: "I'll look at the repo to answer from facts rather than assumptions.",
							details: [
								{
									content: {
										kind: "text",
										value: "I'll look at the repo to answer from facts rather than assumptions.",
									},
								},
								{
									meta: [
										"deepseek-v4-flash",
										"deepseek · openai-completions",
										"stop: toolUse",
										"responseModel deepseek-flash",
										"response fc67b5c4-a97c-44f2-a4f7-e1fe66b389d2",
										"in 3,605 · out 161 · cacheRead 3,328 · cacheWrite — · reasoning 44 tok",
									],
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3826-71df-8e05-5147026a1c61:0",
							entryId: "01a1a0b1-3826-71df-8e05-5147026a1c61",
							stamp: "2026-11-03 17:15:31",
							chip: "TOOL",
							tone: "plain",
							caption: 'bash · { "command": "ls -la; echo \\"---\\"; cat README.md 2>/dev/null | head -100" }',
							details: [
								{
									label: "bash",
									description: "call_00_ypjQIkZGSXTzOotcahYK8039",
								},
								{
									content: {
										kind: "code",
										value: '{\n  "command": "ls -la; echo \\"---\\"; cat README.md 2>/dev/null | head -100"\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3827-70f2-98b7-83facb9a7404:0",
							entryId: "01a1a0b1-3827-70f2-98b7-83facb9a7404",
							stamp: "2026-11-03 17:15:31",
							chip: "TOOL",
							tone: "plain",
							caption: 'bash · { "command": "cat package.json 2>/dev/null; echo \\"---\\"; ls packages docs 2>/dev/null" }',
							details: [
								{
									label: "bash",
									description: "call_01_6W82Q7FVHny5NrZvGaTP4653",
								},
								{
									content: {
										kind: "code",
										value: '{\n  "command": "cat package.json 2>/dev/null; echo \\"---\\"; ls packages docs 2>/dev/null"\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3841-7d5d-befa-276316892002:0",
							entryId: "01a1a0b1-3841-7d5d-befa-276316892002",
							stamp: "2026-11-03 17:15:31",
							chip: "RES",
							tone: "result",
							caption: "total 352",
							details: [
								{
									content: {
										kind: "code",
										value:
											'total 352\ndrwxr-xr-x@  20 user  staff     640 Nov  3 10:31 .\ndrwxr-xr-x@  61 user  staff    1952 Nov  2 17:49 ..\n-rw-r--r--@   1 user  staff     254 Oct 16 16:34 .editorconfig\ndrwxr-xr-x@  15 user  staff     480 Nov  3 17:15 .git\n-rw-r--r--@   1 user  staff     127 Oct 22 17:23 .gitignore\ndrwxr-xr-x@ 149 user  staff    4768 Nov  3 15:20 .logs\n-rw-r--r--@   1 user  staff     255 Oct 16 16:34 .oxfmtrc.json\n-rw-r--r--@   1 user  staff     464 Oct 16 16:34 .oxlintrc.json\n-rw-r--r--@   1 user  staff   14867 Nov  3 15:03 AGENTS.md\ndrwxr-xr-x@   4 user  staff     128 Oct 23 16:45 artifacts\ndrwxr-xr-x@   5 user  staff     160 Nov  3 10:35 assets\n-rw-r--r--@   1 user  staff  123152 Oct 28 15:52 bun.lock\ndrwxr-xr-x@   4 user  staff     128 Nov  3 14:52 extensions\ndrwxr-xr-x@  10 user  staff     320 Oct 20 15:12 node_modules\n-rw-r--r--@   1 user  staff     983 Nov  3 15:00 package.json\ndrwxr-xr-x@  10 user  staff     320 Oct 24 21:42 packages\n-rw-r--r--@   1 user  staff    4327 Nov  3 10:49 README.md\ndrwxr-xr-x@   7 user  staff     224 Nov  3 15:00 scripts\n-rw-r--r--@   1 user  staff     903 Oct 24 21:08 tsconfig.base.json\n-rw-r--r--@   1 user  staff      59 Oct 24 21:08 tsconfig.json\n---\n<div align="center"><a name="readme-top"></a>\n\n<img height="140" src="packages/desktop/build/icon.png" alt="Milu">\n\n<h1>Milu</h1>\n\nAn agent harness with a local core — one IPC protocol, one desktop shell.\n\nYou pick a chat. It reads files, runs commands, and replies. Everything runs on your machine:\nno account, no server of ours, no telemetry, keys and data on disk.\n\n[![][bun-shield]][bun-link]\n[![][electron-shield]][electron-link]\n[![][typescript-shield]][typescript-link]\n[![][tailwind-shield]][tailwind-link]<br/>\n[![][mcp-shield]][mcp-link]\n\n[Report Bug][github-issues-link]\n\n![](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)\n\n</div>\n\n> **Rebuild in progress.** The desktop shell runs; the web end is deferred. The previous\n> implementation — 303 commits, one package, Electrobun — is kept whole at tag `archive/v1`\n> and branch `master`.\n\n## Quick Start\n\nNo build is shipped yet; the sources are the app.\n\n### Development\n\n```bash\nbun install\nbun run dev             # Vite + Electron, main/preload bundled first\nbun run build           # renderer/dist and dist-electron\nbun run start           # Electron against the built renderer\nbun run check           # tsc + oxlint + oxfmt + the package boundaries\n```\n\nThere is no test suite by design; behavior is verified by hand.\n\n## Features\n\n- **Less is more** — keep everything just enough: a minimal prompt, a simple interface,\n  fewer tools.\n- **Optional workspace** — run a chat with no workspace at all for statistics or other\n  global work.\n- **Memory** — each chat keeps its own memory, split into facts, issues and decisions.\n  Keep talking and it grows into scenes, SOPs and a persona that sounds like you.\n- **Long-term chat** — memory and cache hits wired in, so one chat per partner always\n  works in context.\n- **Keyboard** — `⌘P` opens a palette over chats, files and access: switch chat, jump to a\n  file, or give a chat skills and MCP servers.\n- **Permission** — a hard ceiling on the agent: a seatbelt sandbox confines what it can\n  write, a wider mode needs a human to say yes, and `rm` only runs after the move to the\n  trash has failed.\n- **Local** — everything runs on your machine: no account, no server, no telemetry, and\n  your keys and data stay on disk.\n- **Everything as a log** — sessions are append-only, and every view is built from them:\n  transcript, trajectory, replies, git diff, explorer.\n\n## Why not\n\n- **Claude Code** — a nice model under a bad harness: a swollen prompt, 80% of its\n  functions useless for normal scenes, and — the important part — no source to read.\n- **Codex** — an expert at making things complex, then persuading you that\'s the point. An\n  acquired taste, apparently compulsory.\n- **Kimi Code** — a bad UI swollen with functions. Less is More? Never heard of it.\n- **ZCode** — Schrödinger\'s _open-source_: you can\'t tell without opening the box — and GLM\n  is in there either way.\n- **dsh** — DeepSeek Harness: a talented harness — just don\'t hand it to a non-programmer.\n\n---\n\n<div align="center">\n\n**Built on** — [pi](https://pi.dev) · [pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core) · [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) · [Electron](https://www.electronjs.org) · [MCP](https://modelcontextprotocol.io) · [Shiki](https://shiki.style/)\n\n<sub>Made with a fountain pen.</sub>\n\n</div>\n\n[github-issues-link]: https://github.com/mortalYoung/Milu/issues\n[bun-shield]: https://img.shields.io/badge/Bun-1.4-fbf0df?labelColor=black&logo=bun&logoColor=white&style=flat-square\n[bun-link]: https://bun.sh\n[electron-shield]: https://img.shields.io/badge/Electron-44-2f6f9f?labelColor=black&logo=electron&logoColor=white&style=flat-square\n[electron-link]: https://www.electronjs.org\n[typescript-shield]: https://img.shields.io/badge/TypeScript-7-3178c6?labelColor=black&logo=typescript&logoColor=white&style=flat-square\n[typescript-link]: https://www.typescriptlang.org\n[tailwind-shield]: https://img.shields.io/badge/Tailwind-v4-38bdf8?labelColor=black&logo=tailwindcss&logoColor=white&style=flat-square\n[tailwind-link]: https://tailwindcss.com\n[mcp-shield]: https://img.shields.io/badge/MCP-stdio-2f6f9f?labelColor=black&style=flat-square\n[mcp-link]: https://modelcontextprotocol.io\n',
									},
								},
								{
									meta: ["call call_00_ypjQIkZGSXTzOotcahYK8039", "bash", "ok"],
								},
								{
									content: {
										kind: "json",
										value: '{\n  "exitCode": 0,\n  "truncated": false\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3842-7519-b781-9639e26dd447:0",
							entryId: "01a1a0b1-3842-7519-b781-9639e26dd447",
							stamp: "2026-11-03 17:15:31",
							chip: "RES",
							tone: "result",
							caption: "{",
							details: [
								{
									content: {
										kind: "code",
										value:
											'{\n\t"name": "milu",\n\t"version": "0.0.0",\n\t"private": true,\n\t"description": "An agent harness — a local core behind one IPC protocol, rendered by a desktop shell",\n\t"workspaces": [\n\t\t"packages/*"\n\t],\n\t"type": "module",\n\t"scripts": {\n\t\t"boundaries": "bun scripts/boundaries.ts",\n\t\t"build": "bun run --filter \'@milu/desktop\' build",\n\t\t"check": "bun run typecheck && bun run lint && bun run format:check && bun run boundaries",\n\t\t"dev": "bun scripts/dev.ts",\n\t\t"ext:build": "bun scripts/ext-build.ts",\n\t\t"ext:install": "bun run ext:build && bun scripts/ext-install.ts",\n\t\t"format": "oxfmt",\n\t\t"format:check": "oxfmt --check",\n\t\t"lint": "oxlint",\n\t\t"lint:fix": "oxlint --fix",\n\t\t"release": "bun scripts/release.ts",\n\t\t"start": "bun run --filter \'@milu/desktop\' start",\n\t\t"typecheck": "bun run --filter \'*\' typecheck"\n\t},\n\t"devDependencies": {\n\t\t"@types/bun": "latest",\n\t\t"oxfmt": "^0.73.0",\n\t\t"oxlint": "^1.88.0",\n\t\t"typescript": "^7.0.2"\n\t},\n\t"trustedDependencies": [\n\t\t"electron"\n\t]\n}\n---\npackages:\nbootstrap\ncore\ndesktop\ndi\nextension-types\nextensions\nprotocol\nwindow\n\n\nCommand exited with code 1',
									},
								},
								{
									meta: ["call call_01_6W82Q7FVHny5NrZvGaTP4653", "bash", "ok"],
								},
								{
									content: {
										kind: "json",
										value: '{\n  "exitCode": 1,\n  "truncated": false\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3844-7eb1-8f41-e51f6949e139:0",
							entryId: "01a1a0b1-3844-7eb1-8f41-e51f6949e139",
							stamp: "2026-11-03 17:15:31",
							chip: "CTX",
							tone: "reminder",
							caption: "~/Projects/Milu",
							details: [
								{
									content: {
										kind: "json",
										value:
											'{\n  "workspace": "~/Projects/Milu",\n  "storage": "~/partners/Landing/storage",\n  "sandbox": "workspace-write",\n  "skills": [],\n  "timestamp": 1793697331268\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3845-7ecc-b8df-a91eaba10fb1:0",
							entryId: "01a1a0b1-3845-7ecc-b8df-a91eaba10fb1",
							stamp: "2026-11-03 17:15:31",
							chip: "INS",
							tone: "reminder",
							caption: "instructions/changed",
							details: [
								{
									content: {
										kind: "json",
										value:
											'{\n  "agentMd": "# AGENTS.md\\n\\nGuidance for agents working in this repository — a design, not a rulebook. Decide by principle rather than prescribed behavior; facts live in the code and docs, this file steers judgment.\\n\\n## Principles\\n\\n- **Intent** — Understand the ask before acting: match its scope and spirit, not a literal reading. _Example: a \\"check the UI\\" request means analyze and report, not edit; a one-word \\"Fixed all\\" after a review means implement the agreed fixes._\\n- **Simplicity** — Implement the simplest solution that satisfies the current need; delete outdated code outright — no compatibility layers, no migrations, no fallbacks. _Example: this repo is greenfield. There is no legacy data and no released version, so nothing needs to keep working; delete freely._\\n- **Restraint** — Spend tool budget on what the task needs, not habits. _Example: don\'t run `format` or rebuild the view after every change — only when asked, or when a fresh check is required to verify. There is no test suite by design; `bun run typecheck`, `bun run lint` and `bun run format:check` are the gate, and the user verifies behavior._\\n- **Accountability** — Own your changes: keep edits minimal and targeted, report what you changed and why, and surface decisions you made on your own rather than burying them. **Never commit unless the user asks in that message** — land the change in the working tree and report it; the user writes the history.\\n- **Verification** — Confirm your work matches the ask before claiming done, and check claims against the code rather than memory. _Example: run `bun run typecheck` for TS changes; an assertion with no evidence is a guess._\\n\\n## Architecture\\n\\nThe rebuild exists to enforce these rules. Break one and the reason for the rebuild is gone.\\n\\n- **The core does not know how it is reached.** `packages/core` never imports Electron, never opens a socket, never touches `DOM`. It emits typed events and returns values; a transport adapter at the edge decides who hears about it. No `rpc.send.*` anywhere inside the domain.\\n- **The core is runtime-neutral.** It runs in Electron\'s main process today, and could move to a utility process or another shell tomorrow without changing a line. So no Electron, DOM or Bun-only API — `Bun.serve`, `Bun.file`, `bun:sqlite` — and no Bun-shaped types. v1 already satisfies this: it imports only `node:*`, and `pi-agent-core` declares `node >=22`. Keep it that way.\\n- **A service declares its dependencies; the container builds it.** Services are identified by tokens (`ISessionService`), registered into a `ServiceCollection` as instances, factories or `SyncDescriptor`s, and built by `InstantiationService.createInstance`, which resolves the constructor parameters decorated with a token (`@ISessionService`) plus whatever static arguments the descriptor carries. Bun only applies parameter decorators when a `tsconfig.json` with `experimentalDecorators` is visible from the working directory, so `assertDependencies` turns a dropped decorator into a startup error instead of `undefined` fields.\\n- **A singleton is unique to its container, never to the module.** `export const foo = new Foo()` is the v1 mistake wearing a better name — same implicit ordering, same untestable coupling, and it _looks_ clean, so nobody revisits it. The container is the only global.\\n- **State has one owner and an explicit lifecycle.** One service owns each piece of mutable state, and it says out loud how it starts and how it stops (`create → initialize → dispose`). Watchers, timers, `AbortController`s and child processes are all disposed by their owner. v1 leaked every one of these.\\n- **Only state earns a service.** A pure function is a function. Wrapping `fuzzy`, `trajectory`, `token-meter` in a class adds a layer and buys nothing.\\n- **An extension declares its window widgets.** `widgets: [{ id, type, entry, export? }]` on the extension: `type` picks the registry (`slot` / `widget` / `dialog` / `trigger` / `service`), `entry` names the module relative to the extension root, `export` defaults to `default`. The window asks the backend for that list (`widgets`) and imports every entry from the URL it comes back with — a hashed chunk emitted from `widgets.json` for builtins, the package file for a disk extension — so the shell imports no extension code and holds no map of them. Loading happens before the container boots, so a widget may also be a front-end service. A packaged widget receives `{ id, data }` and nothing else: the rest of its surface is `useWidget`, `useSession`, `useCommand` and `useExtensionData(key)` from `globalThis.miluHost.api`, plus React from `globalThis.miluHost.react` — a packaged chunk cannot resolve a bare specifier, so the bridge is the only import it has. Builtin widgets keep the whole `Host` on purpose: they are the shell\'s own chrome. Which shape a widget gets is decided by its `source`, never mixed, and every packaged widget sits inside a boundary that renders a failure line instead of taking the tree down.\\n- **An extension may register a theme.** A theme is one appearance (`light` or `dark`) plus a partial map of the documented tokens; the core registry validates the id and token names, and the window applies the tokens inline over the built-in palette. `settings.theme` is `{ mode, light, dark }`: the mode decides which side is active, the two slots decide which theme each side uses, and a missing theme falls back to the built-in `light`/`dark`.\\n- **A packaged extension is a manifest plus a module.** `package.json` carries `milu.apiVersion`, `milu.widgets`, `milu.contributions` and `milu.services`; the host reads and validates that JSON and never imports the module. Activation is handed to a `utilityProcess` speaking the protocol in `core/src/extensions/host.ts`, and every tool the child registers becomes a host-side proxy. The child sees only the capability surface — `tools.register`, `actions.register`, `hooks.on`, `settings.declare`, `themes.register`, `disposables`, plus a few names the host declares in `CapabilityService` as `core.*` and the child reaches as `context.services.get(\\"core.provider\\")`. A capability is a verb the host performs, never a handle it hands over: arguments and results must survive `structuredClone` (checked in the host), and the API key stays here — the host fetches the balance and hands back the number. Never a live service; a host that exits is restarted (three attempts, then its registrations are torn down and the failure is recorded); `settingsChanged` keeps a declared point in the child in step with `settings.update`, and a manifest item whose `data` reads `{ \\"from\\": \\"extension\\", \\"key\\": … }` is resolved by asking the child for that key when the slot is read; without a host process a packaged extension fails loudly instead of running in the host.\\n- **An extension may declare DI services.** `{ id: ServiceId, create }` declarations are registered before boot, on either end — core through `declareExtensionServices`, the window through a window module\'s `services` export. The name carries the extension (`replies.state`), the container owns the lifecycle, and runtime registration stays closed, so a module-level singleton is still a bug.\\n- **An extension may expose a service across the process boundary.** `milu.services` in the manifest names `<extension>.<name>` plus its methods; the owner implements them in its own process and any caller reaches them by name — `context.services.get(\\"acme.math\\").double(21)` — because a token is an object and objects do not cross. A service here is a method contract, not an object: calls are async, arguments and results must survive `structuredClone` (checked in the host, before the reply leaves), an unknown method names the service and the method, and an owner that is not running fails fast instead of queueing. The proxy re-resolves the owner on every call, so a restarted extension is invisible to callers. Never call another extension\'s service from your own `activate` — boot order is not a promise; call where the work happens. In v1 any extension may call any declared service; that is the local-install trust model, not an oversight.\\n- **Permission must never degrade silently.** v1\'s sandbox chain is empty on anything but macOS, so the gate quietly disappears. A missing sandbox is a hard failure, never a fallback.\\n\\n## Packages\\n\\n| Package                    | May depend on                                              | Never                                    |\\n| -------------------------- | ---------------------------------------------------------- | ---------------------------------------- |\\n| `packages/protocol`        | nothing                                                    | any runtime                              |\\n| `packages/di`              | nothing                                                    | any runtime                              |\\n| `packages/extension-types` | `protocol`, the agent\'s tool types                         | any runtime                              |\\n| `packages/core`            | `protocol`, `di`, `extension-types`                        | Electron, DOM, sockets, Bun-only         |\\n| `packages/window`          | `di`, `protocol`, React, `zustand`, `markdown-it`, `shiki` | Electron, `core`, an extension, a shell  |\\n| `packages/extensions`      | `core`, `di`, `protocol`, `window`, React                  | Electron, `bootstrap`, the desktop shell |\\n| `packages/bootstrap`       | `core`, `extensions`, `window`, `di`                       | Electron, `desktop`                      |\\n| `packages/desktop`         | `core`, `protocol`, `bootstrap`, `extensions`, `window`    | —                                        |\\n\\n`packages/extensions` is the extension set — one folder per extension, nothing else: the window runtime lives in `packages/window`, the host protocol in `core`.\\n\\n`packages/protocol` and `packages/extension-types` are the published surface: they export `src/index.ts` in the workspace and `dist/` from a staged copy. `bun run release` builds both into `artifacts/<package>`, rewrites `workspace:` ranges, and prints the publish command; the workspace manifests stay `private` so nothing can publish them half-built.\\n\\n`packages/bootstrap` is the only place that assembles: `createBackend` for the core container, `createFrontEnd` for the window container. Everything else exports, nothing else composes.\\n\\n`packages/desktop` is the only place allowed to import Electron. Its main process boots the core and owns the IPC edge; its renderer is the React app, loaded from `milu://app/index.html` through a registered custom protocol. Make the boundary a build error, not a convention.\\n\\nBooting the core in-process is what makes the desktop cheap: Electron\'s main process _is_ Node, so `desktop/main.ts` calls `createBackend` and answers the renderer over preload IPC. Splitting the core into a utility process later is a process-boundary change, not a code change — that is the point of runtime neutrality.\\n\\n## Settled decisions\\n\\nDo not re-open these without the user saying so.\\n\\n1. **Single user.** No multi-tenancy, no auth system.\\n2. **One transport: Electron IPC.** Requests are `ipcRenderer.invoke(\\"milu:request\\", method, params)`; events are `webContents.send(\\"milu:event\\", ...)`; the renderer\'s `Transport` port is the only thing that knows the channel names. `Methods` is the only registry. No HTTP server, no WebSocket, no `BrowserView.defineRPC`.\\n3. **Desktop is one app.** Electron\'s main process boots the core in-process; the renderer loads from `milu://app/index.html` through a custom protocol (with a CSP) and talks over a preload bridge with `contextIsolation` and `sandbox`. No port, no token, no network surface. A web end would be another `Transport` adapter later, not another app.\\n4. **Behavior over tests.** No test suite. The user verifies.\\n\\n## v1 is a read-only reference\\n\\nThe previous implementation (303 commits, single package) is tag `archive/v1` and branch `master`. Read it, don\'t edit it — a reference that moves is no longer a reference.\\n\\n```bash\\ngit checkout archive/v1 -- <path>       # pull one file or directory forward\\ngit show archive/v1:src/bun/index.ts    # read without touching the worktree\\n```\\n\\nStill to bring forward: `assets/` (icon, wordmark, `gen-icons.sh`) and `.agents/` + `skills-lock.json` (the `qiaomu-design` skill — it exists nowhere else).\\n\\n## UI philosophy\\n\\nRender only the information the user needs immediately — everything else is collapsed behind a toggle, hover, or focus.\\n\\n## Extension styling\\n\\nAn extension renders inside the host\'s DOM and inherits the host\'s CSS. Only the rows the host\'s Tailwind build emitted exist, and `@source` names only our own sources — so a builtin widget\'s utilities (including arbitrary values) make it into the sheet, while a packaged widget\'s do not.\\n\\n- **Tokens are the contract.** Base variables carry light and dark through `light-dark()`, so `var(--ink)`, `var(--ink-soft)`, `var(--muted)`, `var(--muted-soft)`, `var(--line)`, `var(--line-strong)`, `var(--surface)`, `var(--chrome)`, `var(--canvas)`, `var(--signal)`, `var(--link)`, `var(--hover)`, `var(--selected)`, `var(--caption)`, `var(--accent-teal)`, `var(--accent-amber)`, `var(--code-bg)`, `var(--code-block-bg)` and `var(--code-hairline)` follow the theme without knowing about it. There is no `--line-soft`: the softer hairline is `var(--color-line-soft)` (a `color-mix` of `--line`).\\n- **Owning CSS is allowed, scoped.** A packaged widget may ship its own stylesheet, served from its package; every selector is namespaced under `.milu-ext-<id>` so two extensions cannot collide.\\n- **Utility class names are not an API.** `bar-icon`, `welcome-btn` and friends are internal to the shell; a widget that copies them breaks silently on the next redesign. The same goes for every utility class in a packaged widget: the host\'s sheet never generated it.\\n\\n## Prompt philosophy\\n\\nLess is more — an application of Restraint to prompts. Write the shortest prompt that reliably produces the behavior. Delete rules the model already knows; don\'t duplicate guidance across the prompt, opening message, and tool descriptions; keep runtime facts out of static text and inject them per-run.\\n\\n## Comment philosophy\\n\\nNo explanatory comments unless the user explicitly asks for one. Code should speak for itself — prefer clear names and structure over explanatory comments. If a comment seems necessary, the code likely isn\'t clear enough; improve the code instead.\\n\\nThe one allowed exception is **region-marker comments**: a short banner that labels a section inside a long composition function or controller (for example `// ——— feature controllers ———`). Region markers are structural, not explanatory, and should be the only comments added freely.\\n",\n  "timestamp": 1793697331268\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c:0",
							entryId: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
							stamp: "2026-11-03 17:15:33",
							chip: "THINK",
							tone: "plain",
							caption:
								"The user asks a simple factual question about what Milu is. I've read the README. I can answer concisely. Maybe also check AGENTS.md exists (already have it in system reminder). Answer directly, no need for more tool calls.",
							details: [
								{
									content: {
										kind: "text",
										value:
											"The user asks a simple factual question about what Milu is. I've read the README. I can answer concisely. Maybe also check AGENTS.md exists (already have it in system reminder). Answer directly, no need for more tool calls.\n\nKeep it short and useful.",
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c:1",
							entryId: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
							stamp: "2026-11-03 17:15:33",
							chip: "MSG",
							tone: "plain",
							caption:
								"**Milu** is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.",
							details: [
								{
									content: {
										kind: "text",
										value:
											"**Milu** is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.\n\nThe essentials from the repo:\n\n- **Shape** — `packages/core` is the domain, runtime-neutral (no Electron, no DOM, no sockets, no Bun-only APIs). One transport — Electron IPC — and one desktop shell renders it. `packages/bootstrap` is the only place that assembles the containers; `packages/desktop` is the only place that imports Electron.\n- **Workflow** — you pick a chat; `⌘P` opens a palette over chats, files and access. A chat can run with no workspace at all.\n- **Memory** — per-chat memory split into facts, issues and decisions, growing into scenes, SOPs and a persona.\n- **Permission** — a seatbelt sandbox as a hard ceiling; a wider mode needs a human yes; `rm` only after a move to trash has failed.\n- **Everything as a log** — append-only sessions; transcript, trajectory, replies, git diff and explorer are all views over them.\n- **Stack** — Bun, Electron, TypeScript, Tailwind v4, React, on top of `pi` / `pi-agent-core` / `pi-ai` and MCP.\n\nTwo things worth flagging as context:\n\n1. **It's mid-rebuild.** The desktop shell runs; the web end is deferred. The previous implementation (303 commits, single package, Electrobun) is kept whole at tag `archive/v1` and branch `master` — read-only reference, still holding `assets/` and `.agents/` to bring forward.\n2. **It's opinionated by design.** \"Less is more\": minimal prompt, simple interface, fewer tools. Single user, no auth, no test suite — behavior is verified by hand, and `bun run check` (tsc + oxlint + oxfmt + package boundaries) is the gate.\n\nThe philosophical position is in the README's *Why not* section: Milu exists as a reaction to harnesses that are swollen, closed-source, or hostile to non-programmers.",
									},
								},
								{
									meta: [
										"deepseek-v4-flash",
										"deepseek · openai-completions",
										"stop: stop",
										"responseModel deepseek-flash",
										"response 2073b278-74a6-4d55-ac8e-9ec66994c6ba",
										"in 5,896 · out 549 · cacheRead 3,328 · cacheWrite — · reasoning 58 tok",
									],
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-425d-7b7f-a9ec-224b5206ec44:0",
							entryId: "01a1a0b1-425d-7b7f-a9ec-224b5206ec44",
							stamp: "2026-11-03 17:15:33",
							chip: "END",
							tone: "plain",
							caption: "completed",
							details: [
								{
									meta: ["run 1", "completed"],
								},
							],
							runStart: false,
						},
					],
					entries: 19,
					turns: 2,
				},
				view: {
					rows: [
						{
							key: "01a1a0b1-337b-78cd-aa6a-cd2b1b1db1ea:0",
							entryId: "01a1a0b1-337b-78cd-aa6a-cd2b1b1db1ea",
							stamp: "2026-11-03 17:15:30",
							chip: "Q",
							tone: "user",
							caption: "What is Milu?",
							details: [
								{
									content: {
										kind: "text",
										value: "What is Milu?",
									},
								},
							],
							runStart: true,
						},
						{
							key: "01a1a0b1-3823-7131-8fb4-a71f241bb665:0",
							entryId: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
							stamp: "2026-11-03 17:15:31",
							chip: "THINK",
							tone: "plain",
							caption: 'The user asks "What is Milu?" — a simple question about the project. I should look at the repo to answer factually. Let me check README or docs.',
							details: [
								{
									content: {
										kind: "text",
										value:
											'The user asks "What is Milu?" — a simple question about the project. I should look at the repo to answer factually. Let me check README or docs.\n\nLet me look at the working directory.',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3823-7131-8fb4-a71f241bb665:1",
							entryId: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
							stamp: "2026-11-03 17:15:31",
							chip: "MSG",
							tone: "plain",
							caption: "I'll look at the repo to answer from facts rather than assumptions.",
							details: [
								{
									content: {
										kind: "text",
										value: "I'll look at the repo to answer from facts rather than assumptions.",
									},
								},
								{
									meta: [
										"deepseek-v4-flash",
										"deepseek · openai-completions",
										"stop: toolUse",
										"responseModel deepseek-flash",
										"response fc67b5c4-a97c-44f2-a4f7-e1fe66b389d2",
										"in 3,605 · out 161 · cacheRead 3,328 · cacheWrite — · reasoning 44 tok",
									],
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c:0",
							entryId: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
							stamp: "2026-11-03 17:15:33",
							chip: "THINK",
							tone: "plain",
							caption:
								"The user asks a simple factual question about what Milu is. I've read the README. I can answer concisely. Maybe also check AGENTS.md exists (already have it in system reminder). Answer directly, no need for more tool calls.",
							details: [
								{
									content: {
										kind: "text",
										value:
											"The user asks a simple factual question about what Milu is. I've read the README. I can answer concisely. Maybe also check AGENTS.md exists (already have it in system reminder). Answer directly, no need for more tool calls.\n\nKeep it short and useful.",
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c:1",
							entryId: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
							stamp: "2026-11-03 17:15:33",
							chip: "MSG",
							tone: "plain",
							caption:
								"**Milu** is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.",
							details: [
								{
									content: {
										kind: "text",
										value:
											"**Milu** is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.\n\nThe essentials from the repo:\n\n- **Shape** — `packages/core` is the domain, runtime-neutral (no Electron, no DOM, no sockets, no Bun-only APIs). One transport — Electron IPC — and one desktop shell renders it. `packages/bootstrap` is the only place that assembles the containers; `packages/desktop` is the only place that imports Electron.\n- **Workflow** — you pick a chat; `⌘P` opens a palette over chats, files and access. A chat can run with no workspace at all.\n- **Memory** — per-chat memory split into facts, issues and decisions, growing into scenes, SOPs and a persona.\n- **Permission** — a seatbelt sandbox as a hard ceiling; a wider mode needs a human yes; `rm` only after a move to trash has failed.\n- **Everything as a log** — append-only sessions; transcript, trajectory, replies, git diff and explorer are all views over them.\n- **Stack** — Bun, Electron, TypeScript, Tailwind v4, React, on top of `pi` / `pi-agent-core` / `pi-ai` and MCP.\n\nTwo things worth flagging as context:\n\n1. **It's mid-rebuild.** The desktop shell runs; the web end is deferred. The previous implementation (303 commits, single package, Electrobun) is kept whole at tag `archive/v1` and branch `master` — read-only reference, still holding `assets/` and `.agents/` to bring forward.\n2. **It's opinionated by design.** \"Less is more\": minimal prompt, simple interface, fewer tools. Single user, no auth, no test suite — behavior is verified by hand, and `bun run check` (tsc + oxlint + oxfmt + package boundaries) is the gate.\n\nThe philosophical position is in the README's *Why not* section: Milu exists as a reaction to harnesses that are swollen, closed-source, or hostile to non-programmers.",
									},
								},
								{
									meta: [
										"deepseek-v4-flash",
										"deepseek · openai-completions",
										"stop: stop",
										"responseModel deepseek-flash",
										"response 2073b278-74a6-4d55-ac8e-9ec66994c6ba",
										"in 5,896 · out 549 · cacheRead 3,328 · cacheWrite — · reasoning 58 tok",
									],
								},
							],
							runStart: false,
						},
					],
				},
				slice: {
					rows: [
						{
							key: "01a1a0b1-337b-78cd-aa6a-cd2b1b1db1ea:0",
							entryId: "01a1a0b1-337b-78cd-aa6a-cd2b1b1db1ea",
							stamp: "2026-11-03 17:15:30",
							chip: "Q",
							tone: "user",
							caption: "What is Milu?",
							details: [
								{
									content: {
										kind: "text",
										value: "What is Milu?",
									},
								},
							],
							runStart: true,
						},
						{
							key: "01a1a0b1-3823-7131-8fb4-a71f241bb665:0",
							entryId: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
							stamp: "2026-11-03 17:15:31",
							chip: "THINK",
							tone: "plain",
							caption: 'The user asks "What is Milu?" — a simple question about the project. I should look at the repo to answer factually. Let me check README or docs.',
							details: [
								{
									content: {
										kind: "text",
										value:
											'The user asks "What is Milu?" — a simple question about the project. I should look at the repo to answer factually. Let me check README or docs.\n\nLet me look at the working directory.',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3823-7131-8fb4-a71f241bb665:1",
							entryId: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
							stamp: "2026-11-03 17:15:31",
							chip: "TOOL",
							tone: "plain",
							caption: 'bash · { "command": "ls -la; echo \\"---\\"; cat README.md 2>/dev/null | head -100" }',
							details: [
								{
									label: "bash",
									description: "call_00_ypjQIkZGSXTzOotcahYK8039",
								},
								{
									content: {
										kind: "code",
										value: '{\n  "command": "ls -la; echo \\"---\\"; cat README.md 2>/dev/null | head -100"\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3823-7131-8fb4-a71f241bb665:2",
							entryId: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
							stamp: "2026-11-03 17:15:31",
							chip: "TOOL",
							tone: "plain",
							caption: 'bash · { "command": "cat package.json 2>/dev/null; echo \\"---\\"; ls packages docs 2>/dev/null" }',
							details: [
								{
									label: "bash",
									description: "call_01_6W82Q7FVHny5NrZvGaTP4653",
								},
								{
									content: {
										kind: "code",
										value: '{\n  "command": "cat package.json 2>/dev/null; echo \\"---\\"; ls packages docs 2>/dev/null"\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3823-7131-8fb4-a71f241bb665:3",
							entryId: "01a1a0b1-3823-7131-8fb4-a71f241bb665",
							stamp: "2026-11-03 17:15:31",
							chip: "MSG",
							tone: "plain",
							caption: "I'll look at the repo to answer from facts rather than assumptions.",
							details: [
								{
									content: {
										kind: "text",
										value: "I'll look at the repo to answer from facts rather than assumptions.",
									},
								},
								{
									meta: [
										"deepseek-v4-flash",
										"deepseek · openai-completions",
										"stop: toolUse",
										"responseModel deepseek-flash",
										"response fc67b5c4-a97c-44f2-a4f7-e1fe66b389d2",
										"in 3,605 · out 161 · cacheRead 3,328 · cacheWrite — · reasoning 44 tok",
									],
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3841-7d5d-befa-276316892002:0",
							entryId: "01a1a0b1-3841-7d5d-befa-276316892002",
							stamp: "2026-11-03 17:15:31",
							chip: "RES",
							tone: "result",
							caption: "total 352",
							details: [
								{
									content: {
										kind: "code",
										value:
											'total 352\ndrwxr-xr-x@  20 user  staff     640 Nov  3 10:31 .\ndrwxr-xr-x@  61 user  staff    1952 Nov  2 17:49 ..\n-rw-r--r--@   1 user  staff     254 Oct 16 16:34 .editorconfig\ndrwxr-xr-x@  15 user  staff     480 Nov  3 17:15 .git\n-rw-r--r--@   1 user  staff     127 Oct 22 17:23 .gitignore\ndrwxr-xr-x@ 149 user  staff    4768 Nov  3 15:20 .logs\n-rw-r--r--@   1 user  staff     255 Oct 16 16:34 .oxfmtrc.json\n-rw-r--r--@   1 user  staff     464 Oct 16 16:34 .oxlintrc.json\n-rw-r--r--@   1 user  staff   14867 Nov  3 15:03 AGENTS.md\ndrwxr-xr-x@   4 user  staff     128 Oct 23 16:45 artifacts\ndrwxr-xr-x@   5 user  staff     160 Nov  3 10:35 assets\n-rw-r--r--@   1 user  staff  123152 Oct 28 15:52 bun.lock\ndrwxr-xr-x@   4 user  staff     128 Nov  3 14:52 extensions\ndrwxr-xr-x@  10 user  staff     320 Oct 20 15:12 node_modules\n-rw-r--r--@   1 user  staff     983 Nov  3 15:00 package.json\ndrwxr-xr-x@  10 user  staff     320 Oct 24 21:42 packages\n-rw-r--r--@   1 user  staff    4327 Nov  3 10:49 README.md\ndrwxr-xr-x@   7 user  staff     224 Nov  3 15:00 scripts\n-rw-r--r--@   1 user  staff     903 Oct 24 21:08 tsconfig.base.json\n-rw-r--r--@   1 user  staff      59 Oct 24 21:08 tsconfig.json\n---\n<div align="center"><a name="readme-top"></a>\n\n<img height="140" src="packages/desktop/build/icon.png" alt="Milu">\n\n<h1>Milu</h1>\n\nAn agent harness with a local core — one IPC protocol, one desktop shell.\n\nYou pick a chat. It reads files, runs commands, and replies. Everything runs on your machine:\nno account, no server of ours, no telemetry, keys and data on disk.\n\n[![][bun-shield]][bun-link]\n[![][electron-shield]][electron-link]\n[![][typescript-shield]][typescript-link]\n[![][tailwind-shield]][tailwind-link]<br/>\n[![][mcp-shield]][mcp-link]\n\n[Report Bug][github-issues-link]\n\n![](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)\n\n</div>\n\n> **Rebuild in progress.** The desktop shell runs; the web end is deferred. The previous\n> implementation — 303 commits, one package, Electrobun — is kept whole at tag `archive/v1`\n> and branch `master`.\n\n## Quick Start\n\nNo build is shipped yet; the sources are the app.\n\n### Development\n\n```bash\nbun install\nbun run dev             # Vite + Electron, main/preload bundled first\nbun run build           # renderer/dist and dist-electron\nbun run start           # Electron against the built renderer\nbun run check           # tsc + oxlint + oxfmt + the package boundaries\n```\n\nThere is no test suite by design; behavior is verified by hand.\n\n## Features\n\n- **Less is more** — keep everything just enough: a minimal prompt, a simple interface,\n  fewer tools.\n- **Optional workspace** — run a chat with no workspace at all for statistics or other\n  global work.\n- **Memory** — each chat keeps its own memory, split into facts, issues and decisions.\n  Keep talking and it grows into scenes, SOPs and a persona that sounds like you.\n- **Long-term chat** — memory and cache hits wired in, so one chat per partner always\n  works in context.\n- **Keyboard** — `⌘P` opens a palette over chats, files and access: switch chat, jump to a\n  file, or give a chat skills and MCP servers.\n- **Permission** — a hard ceiling on the agent: a seatbelt sandbox confines what it can\n  write, a wider mode needs a human to say yes, and `rm` only runs after the move to the\n  trash has failed.\n- **Local** — everything runs on your machine: no account, no server, no telemetry, and\n  your keys and data stay on disk.\n- **Everything as a log** — sessions are append-only, and every view is built from them:\n  transcript, trajectory, replies, git diff, explorer.\n\n## Why not\n\n- **Claude Code** — a nice model under a bad harness: a swollen prompt, 80% of its\n  functions useless for normal scenes, and — the important part — no source to read.\n- **Codex** — an expert at making things complex, then persuading you that\'s the point. An\n  acquired taste, apparently compulsory.\n- **Kimi Code** — a bad UI swollen with functions. Less is More? Never heard of it.\n- **ZCode** — Schrödinger\'s _open-source_: you can\'t tell without opening the box — and GLM\n  is in there either way.\n- **dsh** — DeepSeek Harness: a talented harness — just don\'t hand it to a non-programmer.\n\n---\n\n<div align="center">\n\n**Built on** — [pi](https://pi.dev) · [pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core) · [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) · [Electron](https://www.electronjs.org) · [MCP](https://modelcontextprotocol.io) · [Shiki](https://shiki.style/)\n\n<sub>Made with a fountain pen.</sub>\n\n</div>\n\n[github-issues-link]: https://github.com/mortalYoung/Milu/issues\n[bun-shield]: https://img.shields.io/badge/Bun-1.4-fbf0df?labelColor=black&logo=bun&logoColor=white&style=flat-square\n[bun-link]: https://bun.sh\n[electron-shield]: https://img.shields.io/badge/Electron-44-2f6f9f?labelColor=black&logo=electron&logoColor=white&style=flat-square\n[electron-link]: https://www.electronjs.org\n[typescript-shield]: https://img.shields.io/badge/TypeScript-7-3178c6?labelColor=black&logo=typescript&logoColor=white&style=flat-square\n[typescript-link]: https://www.typescriptlang.org\n[tailwind-shield]: https://img.shields.io/badge/Tailwind-v4-38bdf8?labelColor=black&logo=tailwindcss&logoColor=white&style=flat-square\n[tailwind-link]: https://tailwindcss.com\n[mcp-shield]: https://img.shields.io/badge/MCP-stdio-2f6f9f?labelColor=black&style=flat-square\n[mcp-link]: https://modelcontextprotocol.io\n',
									},
								},
								{
									meta: ["call call_00_ypjQIkZGSXTzOotcahYK8039", "bash", "ok"],
								},
								{
									content: {
										kind: "json",
										value: '{\n  "exitCode": 0,\n  "truncated": false\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-3842-7519-b781-9639e26dd447:0",
							entryId: "01a1a0b1-3842-7519-b781-9639e26dd447",
							stamp: "2026-11-03 17:15:31",
							chip: "RES",
							tone: "result",
							caption: "{",
							details: [
								{
									content: {
										kind: "code",
										value:
											'{\n\t"name": "milu",\n\t"version": "0.0.0",\n\t"private": true,\n\t"description": "An agent harness — a local core behind one IPC protocol, rendered by a desktop shell",\n\t"workspaces": [\n\t\t"packages/*"\n\t],\n\t"type": "module",\n\t"scripts": {\n\t\t"boundaries": "bun scripts/boundaries.ts",\n\t\t"build": "bun run --filter \'@milu/desktop\' build",\n\t\t"check": "bun run typecheck && bun run lint && bun run format:check && bun run boundaries",\n\t\t"dev": "bun scripts/dev.ts",\n\t\t"ext:build": "bun scripts/ext-build.ts",\n\t\t"ext:install": "bun run ext:build && bun scripts/ext-install.ts",\n\t\t"format": "oxfmt",\n\t\t"format:check": "oxfmt --check",\n\t\t"lint": "oxlint",\n\t\t"lint:fix": "oxlint --fix",\n\t\t"release": "bun scripts/release.ts",\n\t\t"start": "bun run --filter \'@milu/desktop\' start",\n\t\t"typecheck": "bun run --filter \'*\' typecheck"\n\t},\n\t"devDependencies": {\n\t\t"@types/bun": "latest",\n\t\t"oxfmt": "^0.73.0",\n\t\t"oxlint": "^1.88.0",\n\t\t"typescript": "^7.0.2"\n\t},\n\t"trustedDependencies": [\n\t\t"electron"\n\t]\n}\n---\npackages:\nbootstrap\ncore\ndesktop\ndi\nextension-types\nextensions\nprotocol\nwindow\n\n\nCommand exited with code 1',
									},
								},
								{
									meta: ["call call_01_6W82Q7FVHny5NrZvGaTP4653", "bash", "ok"],
								},
								{
									content: {
										kind: "json",
										value: '{\n  "exitCode": 1,\n  "truncated": false\n}',
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c:0",
							entryId: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
							stamp: "2026-11-03 17:15:33",
							chip: "THINK",
							tone: "plain",
							caption:
								"The user asks a simple factual question about what Milu is. I've read the README. I can answer concisely. Maybe also check AGENTS.md exists (already have it in system reminder). Answer directly, no need for more tool calls.",
							details: [
								{
									content: {
										kind: "text",
										value:
											"The user asks a simple factual question about what Milu is. I've read the README. I can answer concisely. Maybe also check AGENTS.md exists (already have it in system reminder). Answer directly, no need for more tool calls.\n\nKeep it short and useful.",
									},
								},
							],
							runStart: false,
						},
						{
							key: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c:1",
							entryId: "01a1a0b1-425b-7e42-b61e-4500dafa1a0c",
							stamp: "2026-11-03 17:15:33",
							chip: "MSG",
							tone: "plain",
							caption:
								"**Milu** is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.",
							details: [
								{
									content: {
										kind: "text",
										value:
											"**Milu** is an agent harness with a local core, built by you (this repo) — a desktop app where you pick a chat, and the agent reads files, runs commands, and replies. Everything runs on your machine: no account, no server, no telemetry, keys and data on disk.\n\nThe essentials from the repo:\n\n- **Shape** — `packages/core` is the domain, runtime-neutral (no Electron, no DOM, no sockets, no Bun-only APIs). One transport — Electron IPC — and one desktop shell renders it. `packages/bootstrap` is the only place that assembles the containers; `packages/desktop` is the only place that imports Electron.\n- **Workflow** — you pick a chat; `⌘P` opens a palette over chats, files and access. A chat can run with no workspace at all.\n- **Memory** — per-chat memory split into facts, issues and decisions, growing into scenes, SOPs and a persona.\n- **Permission** — a seatbelt sandbox as a hard ceiling; a wider mode needs a human yes; `rm` only after a move to trash has failed.\n- **Everything as a log** — append-only sessions; transcript, trajectory, replies, git diff and explorer are all views over them.\n- **Stack** — Bun, Electron, TypeScript, Tailwind v4, React, on top of `pi` / `pi-agent-core` / `pi-ai` and MCP.\n\nTwo things worth flagging as context:\n\n1. **It's mid-rebuild.** The desktop shell runs; the web end is deferred. The previous implementation (303 commits, single package, Electrobun) is kept whole at tag `archive/v1` and branch `master` — read-only reference, still holding `assets/` and `.agents/` to bring forward.\n2. **It's opinionated by design.** \"Less is more\": minimal prompt, simple interface, fewer tools. Single user, no auth, no test suite — behavior is verified by hand, and `bun run check` (tsc + oxlint + oxfmt + package boundaries) is the gate.\n\nThe philosophical position is in the README's *Why not* section: Milu exists as a reaction to harnesses that are swollen, closed-source, or hostile to non-programmers.",
									},
								},
								{
									meta: [
										"deepseek-v4-flash",
										"deepseek · openai-completions",
										"stop: stop",
										"responseModel deepseek-flash",
										"response 2073b278-74a6-4d55-ac8e-9ec66994c6ba",
										"in 5,896 · out 549 · cacheRead 3,328 · cacheWrite — · reasoning 58 tok",
									],
								},
							],
							runStart: false,
						},
					],
					turns: 2,
				},
			},
		},
	},
];
