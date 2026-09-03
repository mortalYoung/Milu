/**
 * Composer — the input area (direction D · workbench):
 * a bordered field with a seal focus ring; Enter sends (IME-safe: composition Enter confirms
 * the IME candidate, it must not send), Shift+Enter inserts a newline; the send button appears
 * only when there is something to send (text or a run to stop); it becomes a stop button while
 * running. Context occupancy ring sits inside the field. Runtime context — workspace/storage path,
 * model, sandbox mode, session metrics — live behind a quiet toggle left of the field: the
 * static composer shows only the pill, and the panel opens on demand (click / outside / Esc
 * to dismiss; sending closes it too).
 *
 * Slash commands share the same pill: a leading "/" opens the command menu above it; Enter or
 * Tab selects the highlighted command (unknown "/…" lines are blocked, never sent to the
 * model), and leadingInput commands (/workspace) claim the line until the argument is typed.
 */
import { ArrowUp, ExternalLink, SlidersHorizontal, Square } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show, untrack } from "solid-js";
import type { CommandDescriptor, SandboxMode, SkillDescriptor } from "../../shared/rpc";
import { filterCommands } from "../lib/commands";
import { formatWorkspacePath, shouldSendOnEnter } from "../lib/composer-input";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useCommandDirectory } from "../lib/contexts/commands-context";
import { useComposer } from "../lib/contexts/composer-context";
import { useMetrics } from "../lib/contexts/metrics-context";
import { useSession } from "../lib/contexts/session-context";
import { detectTrigger, parseCommand } from "../lib/trigger";
import { Button } from "./Button";
import { CommandMenu } from "./CommandMenu";
import { ContextMeter } from "./ContextMeter";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupLabel,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Select } from "./ui/select";

/** Auto-grow ceiling (~5 lines); beyond that the textarea scrolls internally. */
const MAX_HEIGHT = 120;

/** 1,234 → "1.2k"; 1,234,567 → "1.2M" */
function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(Math.round(n));
}

export function Composer(props: {
	onSend: (text: string) => void;
	onStop: () => void;
	skills?: SkillDescriptor[];
	onSkill?: (name: string, hint?: string) => Promise<{ ok: boolean; error?: string }>;
	onShell?: (command: string) => Promise<{ ok: boolean; error?: string; shellId?: string }>;
	onOpenPath?: (path: string, editorId?: string) => void;
	/** Detected code editors (right-click menu on ws/st paths). */
	editors?: { id: string; name: string }[];
}) {
	const metrics = useMetrics();
	const agent = useAgentStatus();
	const composer = useComposer();
	const session = useSession();
	const commandDirectory = useCommandDirectory();
	const [text, setText] = createSignal("");
	// The draft is per-chat: switching chats loads the other chat's saved text and resets the box height.
	createEffect(() => {
		const name = session.data.selected;
		void name;
		const value = untrack(() => (name ? (composer.drafts()[name] ?? "") : ""));
		setText(value);
		setMenuOpen(false);
		setClaimed(null);
		requestAnimationFrame(() => {
			if (!textareaRef) return;
			textareaRef.style.height = "";
			resize();
			focusEnd();
		});
	});
	let textareaRef: HTMLTextAreaElement | undefined;
	// IME guard: composition Enter picks a candidate, it must not send. The flag outlives
	// renders; clearing is deferred one tick because Safari delivers the closing keydown
	// AFTER compositionend.
	let composing = false;
	let pendingImeFix: { data: string; fixed: string; cursor: number } | null = null;
	const onCompositionStart = () => {
		composing = true;
	};
	const onCompositionEnd = (e: CompositionEvent) => {
		const data = e.data ?? "";
		// WKWebView commits pinyin-mode English as the display string with syllable spaces
		// ("hap p"); when no CJK was selected, restore the raw letters by dropping spaces.
		if (/^[A-Za-z\s]+$/.test(data) && data !== data.replace(/\s/g, "")) {
			const el = textareaRef;
			if (el) {
				pendingImeFix = { data, fixed: data.replace(/\s/g, ""), cursor: el.selectionStart ?? el.value.length };
			}
			setTimeout(() => {
				const fix = pendingImeFix;
				const target = textareaRef;
				if (!fix || !target) return;
				const value = target.value;
				const start = Math.max(0, fix.cursor - fix.data.length);
				if (value.slice(start, start + fix.data.length) !== fix.data) return;
				const next = value.slice(0, start) + fix.fixed + value.slice(start + fix.data.length);
				pendingImeFix = null;
				setText(next);
				composer.change(next);
				target.value = next;
				const pos = start + fix.fixed.length;
				target.setSelectionRange(pos, pos);
				setCaret(pos);
				resize();
			}, 0);
		}
		setTimeout(() => {
			composing = false;
		}, 10);
	};

	// ————— slash command state (plain / claimed / submitting) —————
	let lastTriggerKey: string | null = null;
	let suppressNextSync = false;
	const [caret, setCaret] = createSignal(0);
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [menuQuery, setMenuQuery] = createSignal("");
	const [selectedIndex, setSelectedIndex] = createSignal(0);
	const [claimed, setClaimed] = createSignal<CommandDescriptor | null>(null);
	const [submitting, setSubmitting] = createSignal(false);
	const [shellMode, setShellMode] = createSignal(false);
	const menuItems = createMemo(() => {
		const q = menuQuery();
		const commands = filterCommands(commandDirectory.commands(), q);
		const skillItems = (props.skills ?? [])
			.filter((s) => s.userInvocable)
			.map(
				(s): CommandDescriptor => ({
					name: `skill:${s.name}`,
					description: s.description,
					kind: "execute",
					category: "skill",
				}),
			)
			.filter((s) => !q || s.name.startsWith(q) || s.name.includes(q))
			.sort((a, b) => a.name.localeCompare(b.name));
		return [...commands, ...skillItems];
	});

	// Runtime-context panel: closed by default; the toggle icon left of the field opens it on demand.
	const [panelOpen, setPanelOpen] = createSignal(false);
	let rootRef: HTMLFormElement | undefined;
	// Outside click / Escape close the panel; clicks inside the composer (typing, changing a
	// select) keep it open — only dismissal and the send action close it.
	createEffect(() => {
		if (!panelOpen()) return;
		const onPointerDown = (e: PointerEvent) => {
			if (e.target instanceof Node && rootRef?.contains(e.target)) return;
			// Clicking a floating menu (e.g. the ws/st path context menu) is not "outside the panel".
			if (e.target instanceof Element && e.target.closest('[role="menu"], [data-kb-menu-content]')) return;
			setPanelOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setPanelOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		onCleanup(() => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		});
	});

	const resize = () => {
		const el = textareaRef;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
	};

	const focusEnd = () => {
		const el = textareaRef;
		if (!el) return;
		el.focus();
		const len = el.value.length;
		el.setSelectionRange(len, len);
	};

	const clearText = () => {
		setText("");
		composer.change("");
		if (textareaRef) textareaRef.style.height = "";
	};

	/** Keep the menu / claimed state in sync with the draft + caret (pure detection, no async). */
	function syncCommandState(value: string, pos: number) {
		if (claimed()) {
			// A claimed leadingInput command survives only while its prefix is intact.
			if (!value.startsWith(`/${claimed()!.name} `)) setClaimed(null);
			setMenuOpen(false);
			return;
		}
		const trigger = detectTrigger(value, pos);
		if (trigger?.trigger === "/" && trigger.position === "leading") {
			const key = `${trigger.position}:${trigger.query}`;
			if (!menuOpen() || lastTriggerKey !== key) setSelectedIndex(0);
			lastTriggerKey = key;
			setMenuQuery(trigger.query);
			setMenuOpen(true);
		} else {
			setMenuOpen(false);
			lastTriggerKey = null;
		}
	}

	async function executeCommand(line: string) {
		if (submitting()) return;
		setSubmitting(true);
		setMenuOpen(false);
		setClaimed(null);
		try {
			const res = await commandDirectory.execute(line);
			if (res.ok) clearText();
		} finally {
			setSubmitting(false);
		}
	}

	function claimLeading(cmd: CommandDescriptor) {
		setText(`/${cmd.name} `);
		composer.change(`/${cmd.name} `);
		setClaimed(cmd);
		setMenuOpen(false);
		queueMicrotask(focusEnd);
	}

	async function executeSkill(name: string, hint?: string) {
		if (submitting()) return;
		setSubmitting(true);
		setMenuOpen(false);
		setClaimed(null);
		clearText();
		try {
			await props.onSkill?.(name, hint);
		} finally {
			setSubmitting(false);
		}
	}

	async function executeShell() {
		if (submitting()) return;
		const value = text();
		const trimmed = value.trim();
		if (!trimmed) return;
		setSubmitting(true);
		setMenuOpen(false);
		setClaimed(null);
		clearText();
		try {
			const res = await props.onShell?.(trimmed);
			if (res && !res.ok) {
				setText(trimmed);
				composer.change(trimmed);
			}
		} finally {
			setSubmitting(false);
		}
	}

	function pickCommand(index: number) {
		const item = menuItems()[index];
		if (!item) return;
		if (item.kind === "leadingInput" || item.hint || item.category === "skill") {
			claimLeading(item);
			return;
		}
		if (item.kind === "popupSelect") {
			setMenuOpen(false);
			return;
		}
		void executeCommand(`/${item.name}`);
	}

	async function submit() {
		if (submitting()) return;
		const value = text();
		const trimmed = value.trim();
		if (!trimmed) return;
		const skillMatch = /^\/skill:([a-z0-9_-]+)(?:\s+(.*))?$/.exec(trimmed);
		if (skillMatch) {
			setPanelOpen(false);
			await executeSkill(skillMatch[1], skillMatch[2]?.trim() || undefined);
			return;
		}
		const parsed = parseCommand(trimmed);
		const cmd = parsed ? commandDirectory.commands().find((c) => c.name === parsed.name) : undefined;

		// Unknown "/…" is never a model message: keep the "no command found" state visible.
		if (parsed && !cmd) {
			setMenuOpen(true);
			setMenuQuery(parsed.name);
			return;
		}
		// A bare "/" (no parseable command name) is still a command attempt, not a message.
		if (trimmed.startsWith("/") && !cmd) {
			setMenuOpen(true);
			setMenuQuery(trimmed.slice(1).split(/\s/)[0] ?? "");
			return;
		}

		if (cmd) {
			if (cmd.kind === "popupSelect") {
				setMenuOpen(false);
				return;
			}
			if (cmd.kind === "leadingInput" && !parsed!.rawInput.trim()) {
				claimLeading(cmd);
				return;
			}
			await executeCommand(trimmed);
			return;
		}

		// Normal message: sending returns to the letter — the settings panel folds back.
		setPanelOpen(false);
		clearText();
		props.onSend(trimmed);
	}

	const submitForm: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (e) => {
		e.preventDefault();
		void submit();
	};

	const onKeyDown: JSX.EventHandler<HTMLTextAreaElement, KeyboardEvent> = (e) => {
		if (menuOpen() && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
			e.preventDefault();
			const items = menuItems();
			if (items.length > 0) {
				const delta = e.key === "ArrowDown" ? 1 : -1;
				setSelectedIndex((i) => (i + delta + items.length) % items.length);
			}
			return;
		}
		if (e.key === "Escape" && (menuOpen() || claimed())) {
			suppressNextSync = true;
			setMenuOpen(false);
			setClaimed(null);
			return;
		}
		if (e.key === "Tab" && !e.shiftKey && menuOpen() && menuItems().length > 0) {
			e.preventDefault();
			pickCommand(selectedIndex());
			return;
		}
		if (e.key === "Tab" && !e.shiftKey && !menuOpen() && text().trim() === "") {
			e.preventDefault();
			setShellMode((v) => !v);
			return;
		}
		if (e.key === " " && !e.shiftKey) {
			const parsed = parseCommand(text());
			if (parsed && !parsed.rawInput.trim()) {
				const cmd = commandDirectory.commands().find((c) => c.name === parsed.name && c.kind === "leadingInput");
				if (cmd) {
					e.preventDefault();
					claimLeading(cmd);
					return;
				}
			}
		}
		if (shouldSendOnEnter({ keyCode: e.keyCode, shiftKey: e.shiftKey, repeat: e.repeat, composing, isComposing: e.isComposing })) {
			e.preventDefault();
			if (shellMode()) {
				void executeShell();
				return;
			}
			const parsed = parseCommand(text());
			const exact = parsed ? commandDirectory.commands().find((c) => c.name === parsed.name) : undefined;
			const canExecuteLine = exact && (exact.kind === "execute" || (exact.kind === "leadingInput" && parsed!.rawInput.trim()));
			if (canExecuteLine || !menuOpen() || menuItems().length === 0) {
				void submit();
			} else {
				pickCommand(selectedIndex());
			}
		}
	};

	// Send appears only when there is something to send (or a run to stop)
	const showSend = () => text().trim() !== "" || agent.isBusyForSelected();

	// Path line: workspace/storage are clickable to open in the user's code editor; right-click
	// offers every installed editor, left-click uses the default (VS Code when present).
	const openPath = (path: string, editorId?: string) => props.onOpenPath?.(path, editorId);
	const pathButton = (label: string, path: string) => (
		<ContextMenu>
			<ContextMenuTrigger as="button" type="button" class="composer-path-open" title="Open folder in code editor" onClick={() => openPath(path)}>
				<span class="composer-path-label">{label}</span> {formatWorkspacePath(path, 36)}
				<ExternalLink size={10} class="composer-path-external" />
			</ContextMenuTrigger>
			<ContextMenuContent size="sm" portal={false}>
				<For each={props.editors ?? []}>
					{(editor) => (
						<ContextMenuItem size="sm" onSelect={() => openPath(path, editor.id)}>
							Open in {editor.name}
						</ContextMenuItem>
					)}
				</For>
				<ContextMenuItem size="sm" onSelect={() => openPath(path)}>
					Open with default
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
	const pathLine = () => {
		const parts: JSX.Element[] = [];
		const ws = agent.data().workspace_path;
		const storage = agent.data().storage_path;
		if (ws) parts.push(pathButton("ws", ws));
		if (ws && storage) parts.push(<span class="composer-path-sep">·</span>);
		if (storage) parts.push(pathButton("st", storage));
		return parts;
	};
	const pathTitle = () => {
		const ws = agent.data().workspace_path;
		const storage = agent.data().storage_path;
		return [ws && `workspace: ${ws}`, storage && `storage: ${storage}`].filter(Boolean).join("\n");
	};

	const statsLine = () => {
		const s = metrics()?.stats ?? null;
		if (!s || !s.usage) return null;
		const u = s.usage;
		const billed = u.input + u.cacheRead + u.cacheWrite;
		const hit = billed > 0 ? Math.round((u.cacheRead / billed) * 100) : null;
		const parts = [`in ${formatTokens(u.input)} tok`, `out ${formatTokens(u.output)} tok`];
		if (hit != null) parts.push(`cache ${hit}%`);
		if (s.runtime.avgTtftMs != null) parts.push(`ttft ${(s.runtime.avgTtftMs / 1000).toFixed(1)}s`);
		if (s.runtime.avgTps != null) parts.push(`${Math.round(s.runtime.avgTps)} tok/s`);
		return parts.join(" · ");
	};

	const status = () => (agent.isBusyForSelected() ? "writing…" : null);

	const modelLabel = () => {
		const m = agent.data().model;
		if (!m?.modelId) return "default model";
		return m.modelId;
	};

	return (
		<form class="composer" id="composer" ref={rootRef} onSubmit={submitForm}>
			{/* Command palette: opens above the pill for a leading "/" (paper language, no shadow) */}
			<Show when={menuOpen()}>
				<CommandMenu items={menuItems()} selectedIndex={selectedIndex()} onPick={pickCommand} onHover={setSelectedIndex} />
			</Show>
			{/* The pill, with the runtime-context toggle on its left (the send button stays alone on the right) */}
			<div class="composer-row">
				<Button
					variant="ghost"
					size="icon"
					class="composer-toggle"
					title={panelOpen() ? "Hide runtime context" : "Runtime context"}
					aria-label="Runtime context"
					aria-expanded={panelOpen()}
					aria-controls="composer-panel"
					icon={<SlidersHorizontal size={15} />}
					onClick={() => setPanelOpen((v) => !v)}
				/>
				<div class={"composer-field" + (shellMode() ? " shell" : "")}>
					{shellMode() && (
						<span class="composer-shell-prefix" aria-hidden="true">
							$
						</span>
					)}
					{shellMode() && <span class="composer-shell-tag">shell</span>}
					<textarea
						id="prompt-input"
						ref={textareaRef}
						value={text()}
						onInput={(e) => {
							const el = e.currentTarget;
							const value = el.value;
							setText(value);
							composer.change(value);
							setCaret(el.selectionStart ?? value.length);
							suppressNextSync = false;
							syncCommandState(value, caret());
							resize();
						}}
						onKeyDown={onKeyDown}
						onKeyUp={(e) => {
							if (suppressNextSync) return;
							const el = e.currentTarget;
							setCaret(el.selectionStart ?? el.value.length);
							syncCommandState(el.value, caret());
						}}
						onSelect={(e) => {
							if (suppressNextSync) return;
							const el = e.currentTarget;
							setCaret(el.selectionStart ?? el.value.length);
							syncCommandState(el.value, caret());
						}}
						onCompositionStart={onCompositionStart}
						onCompositionEnd={onCompositionEnd}
						class="composer-input"
						rows={1}
						placeholder="Type a message…"
						autocomplete="off"
						spellcheck={false}
						aria-label="Message"
					/>
					{metrics()?.contextUsage ? <ContextMeter usage={metrics()!.contextUsage!} /> : null}
					{showSend() && (
						<Button
							variant={agent.isBusyForSelected() ? "outline" : "seal"}
							class={`size-[34px] p-0 rounded-full shrink-0 ${agent.isBusyForSelected() ? "composer-stop" : ""}`}
							title={agent.isBusyForSelected() ? "Stop" : "Send"}
							icon={agent.isBusyForSelected() ? <Square size={14} /> : <ArrowUp size={14} />}
							onClick={() => (agent.isBusyForSelected() ? props.onStop() : void submit())}
						/>
					)}
				</div>
			</div>
			{/* Runtime-context panel: path line (read-only), model / sandbox controls, then status +
			   session metrics as a quiet footnote; on-demand only — closed by outside click, Esc or sending */}
			<Show when={panelOpen()}>
				<div id="composer-panel" class="composer-panel" role="group" aria-label="Runtime context">
					{(agent.data().workspace_path || agent.data().storage_path) && (
						<div class="composer-panel-path">
							<span class="composer-path" title={pathTitle()}>
								{pathLine()}
							</span>
						</div>
					)}
					<div class="composer-panel-row">
						{agent.data().models.length > 0 && (
							<DropdownMenu>
								<DropdownMenuTrigger
									class="shrink-0 min-w-0 max-w-[200px] inline-flex h-[30px] items-center justify-between gap-2 rounded-[8px] border border-hairline bg-transparent px-2.5 font-mono text-[10px] text-ink-soft outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-letter data-[expanded]:border-seal"
									title="Model / Effort (per partner)"
								>
									<span class="truncate">
										{modelLabel()}·{agent.data().thinking_level}
									</span>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 8 8"
										fill="none"
										stroke="currentColor"
										stroke-width="1.2"
										stroke-linecap="round"
										stroke-linejoin="round"
										class="size-2 shrink-0 text-muted"
									>
										<path d="M1 2.5 4 5.5 7 2.5" />
									</svg>
								</DropdownMenuTrigger>
								<DropdownMenuContent portalMount={rootRef} class="min-w-40">
									<DropdownMenuSub>
										<DropdownMenuSubTrigger class="font-mono text-[10px]">Models</DropdownMenuSubTrigger>
										<DropdownMenuSubContent portalMount={rootRef}>
											<For each={agent.data().models}>
												{(g) => (
													<DropdownMenuGroup>
														<DropdownMenuGroupLabel class="font-mono text-[10px]">{g.provider}</DropdownMenuGroupLabel>
														<For each={g.models}>
															{(m) => (
																<DropdownMenuItem class="font-mono text-[10px] text-ink-soft" onSelect={() => agent.mutateModel({ provider: g.provider, modelId: m.id })}>
																	{m.name}
																</DropdownMenuItem>
															)}
														</For>
													</DropdownMenuGroup>
												)}
											</For>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger class="font-mono text-[10px]">Effort</DropdownMenuSubTrigger>
										<DropdownMenuSubContent portalMount={rootRef}>
											<For each={agent.data().thinking_levels}>
												{(level) => (
													<DropdownMenuItem class="font-mono text-[10px] text-ink-soft" onSelect={() => agent.mutateThinkingLevel(level)}>
														<span>{level}</span>
														{level === agent.data().thinking_level && <span class="ml-auto text-seal">✓</span>}
													</DropdownMenuItem>
												)}
											</For>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
						<Select
							class="shrink-0"
							title="Sandbox mode (file writes)"
							ariaLabel="Sandbox mode"
							value={agent.data().sandbox_mode}
							portalMount={rootRef}
							onChange={(value) => agent.mutateSandboxMode(value as SandboxMode)}
							options={[
								{ value: "read-only", label: "read-only" },
								{ value: "workspace-write", label: "workspace-write" },
								{ value: "danger-full-access", label: "full access" },
							]}
						/>
					</div>
					{(status() || statsLine()) && (
						<div class="composer-panel-foot">
							{status() && (
								<span class="composer-status">
									<span class="composer-status-dot" />
									<span>{status()}</span>
								</span>
							)}
							{statsLine() && <span class="composer-stats">{statsLine()}</span>}
						</div>
					)}
				</div>
			</Show>
		</form>
	);
}
