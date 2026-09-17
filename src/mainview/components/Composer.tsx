import { ArrowUp, SlidersHorizontal, Square } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show, untrack } from "solid-js";
import type { CommandDescriptor, SandboxMode } from "../../shared/rpc";
import { filterCommands } from "../lib/commands";
import { shouldSendOnEnter } from "../lib/composer-input";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useCommandDirectory } from "../lib/contexts/commands-context";
import { useComposer } from "../lib/contexts/composer-context";
import { useMetrics } from "../lib/contexts/metrics-context";
import { useScroll } from "../lib/contexts/scroll-context";
import { useSession } from "../lib/contexts/session-context";
import { useSettings } from "../lib/contexts/settings-context";
import { useSkills } from "../lib/contexts/skills-context";
import { useToast } from "../lib/contexts/toast-context";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { detectTrigger, parseCommand } from "../lib/trigger";
import { formatTokens } from "../lib/utils";
import { Button } from "./Button";
import { CommandMenu } from "./CommandMenu";
import { ContextMeter } from "./ContextMeter";
import { EditorPathButton } from "./EditorPathButton";
import { FollowUpDock } from "./FollowUpDock";
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

const MAX_HEIGHT = 120;

export function Composer(props: {
	onSend: (text: string) => void;
	onStop: () => void;
	onShell?: (command: string) => Promise<{ ok: boolean; error?: string; shellId?: string }>;
	onOpenPath?: (path: string, editorId?: string) => void;
	editors?: { id: string; name: string }[];
}) {
	const metrics = useMetrics();
	const agent = useAgentStatus();
	const composer = useComposer();
	const session = useSession();
	const settings = useSettings();
	const scroll = useScroll();
	const toast = useToast();
	const commandDirectory = useCommandDirectory();
	const skillDirectory = useSkills();
	const shellContinuous = () => settings.data()?.settings?.shellContinuous ?? true;
	const [text, setText] = createSignal("");
	createEffect(() => {
		const request = composer.pendingPrefill();
		if (!request || request.partner !== session.data.selected) return;
		composer.consumePrefill(request.id);
		setText(request.text);
		composer.change(request.text);
		requestAnimationFrame(() => {
			if (!textareaRef) return;
			textareaRef.focus();
			textareaRef.setSelectionRange(request.text.length, request.text.length);
			setCaret(request.text.length);
			syncCommandState(request.text, request.text.length);
			resize();
		});
	});
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
	let composing = false;
	let pendingImeFix: { data: string; fixed: string; cursor: number } | null = null;
	const onCompositionStart = () => {
		composing = true;
	};
	const onCompositionEnd = (e: CompositionEvent) => {
		const data = e.data ?? "";
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
		const skillItems = filterCommands(
			(skillDirectory.data() ?? [])
				.filter((s) => s.userInvocable)
				.map(
					(s): CommandDescriptor => ({
						name: `skill:${s.name}`,
						description: s.description,
						kind: "execute",
						category: "skill",
					}),
				),
			q,
		);
		return [...commands, ...skillItems];
	});

	const [panelOpen, setPanelOpen] = createSignal(false);

	// Two Esc layers of its own: the command menu (attached to the field) over the runtime panel.
	useEscapeLayer({
		id: "composer.menu",
		order: ESCAPE_ORDER.composerMenu,
		isOpen: () => menuOpen() || claimed() != null,
		close: () => {
			suppressNextSync = true;
			setMenuOpen(false);
			setClaimed(null);
		},
	});
	useEscapeLayer({ id: "composer.panel", order: ESCAPE_ORDER.composerPanel, isOpen: panelOpen, close: () => setPanelOpen(false) });

	const commandHint = createMemo(() => {
		if (menuOpen() || panelOpen() || shellMode() || submitting()) return null;
		const parsed = parseCommand(text());
		if (!parsed || parsed.rawInput.trim()) return null;
		const cmd = commandDirectory.commands().find((c) => c.name === parsed.name);
		return cmd?.hint ? cmd : null;
	});
	let rootRef: HTMLFormElement | undefined;
	// Closes on a click outside; Esc goes through the app's single handler (lib/escape.ts).
	createEffect(() => {
		if (!panelOpen()) return;
		const onPointerDown = (e: PointerEvent) => {
			if (e.target instanceof Node && rootRef?.contains(e.target)) return;
			if (e.target instanceof Element && e.target.closest('[role="menu"], [data-kb-menu-content]')) return;
			setPanelOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
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

	function syncCommandState(value: string, pos: number) {
		if (shellMode()) {
			setMenuOpen(false);
			lastTriggerKey = null;
			return;
		}
		if (claimed()) {
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

	async function executeCommand(line: string, consumed = false) {
		if (submitting()) return;
		setSubmitting(true);
		setMenuOpen(false);
		setClaimed(null);
		scroll.pin(true);
		if (consumed) clearText();
		try {
			const execution = await commandDirectory.execute(line);
			if (execution.ok) clearText();
			if (!execution.ok) toast.push({ title: "Couldn't run the command", body: execution.error ?? "Unknown error" }, "error");
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
		scroll.pin(true);
		try {
			const res = await skillDirectory.mutate.execute(name, hint);
			if (!res.ok) toast.push({ title: "Couldn't run the skill", body: res.error ?? "Unknown error" }, "error");
		} finally {
			setSubmitting(false);
		}
	}

	async function executeShell() {
		if (submitting()) return;
		const trimmed = text().trim();
		if (!trimmed) return;
		setSubmitting(true);
		setMenuOpen(false);
		setClaimed(null);
		clearText();
		if (!shellContinuous()) setShellMode(false);
		try {
			await props.onShell?.(trimmed);
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
		if (shellMode()) {
			await executeShell();
			return;
		}
		const skillMatch = /^\/skill:([a-z0-9_-]+)(?:\s+(.*))?$/.exec(trimmed);
		if (skillMatch) {
			setPanelOpen(false);
			await executeSkill(skillMatch[1], skillMatch[2]?.trim() || undefined);
			return;
		}
		const parsed = parseCommand(trimmed);
		const cmd = parsed ? commandDirectory.commands().find((c) => c.name === parsed.name) : undefined;

		if (parsed && !cmd) {
			setMenuOpen(true);
			setMenuQuery(parsed.name);
			return;
		}
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
			await executeCommand(trimmed, Boolean(parsed?.rawInput.trim()));
			return;
		}

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

	const showSend = () => text().trim() !== "" || agent.isBusyForSelected();

	const openPath = (path: string, editorId?: string) => props.onOpenPath?.(path, editorId);
	const pathLine = () => {
		const parts: JSX.Element[] = [];
		const ws = agent.data().workspace_path;
		const storage = agent.data().storage_path;
		if (ws) parts.push(<EditorPathButton label="ws" path={ws} class="-mx-1 px-1" editors={props.editors} onOpenPath={openPath} />);
		if (ws && storage) parts.push(<span class="composer-path-sep">·</span>);
		if (storage) parts.push(<EditorPathButton label="st" path={storage} class="-mx-1 px-1" editors={props.editors} onOpenPath={openPath} />);
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
		const hit = billed > 0 ? (u.cacheRead / billed) * 100 : null;
		const parts = [`in ${formatTokens(u.input)} tok`, `out ${formatTokens(u.output)} tok`];
		if (hit != null) parts.push(`cache ${hit.toFixed(2)}%`);
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
			<Show when={menuOpen()}>
				<CommandMenu items={menuItems()} selectedIndex={selectedIndex()} onPick={pickCommand} onHover={setSelectedIndex} />
			</Show>
			<Show when={commandHint()}>
				{(cmd) => (
					<div class="composer-command-hint">
						<span class="composer-command-hint-name">/{cmd().name}</span>
						<span class="composer-command-hint-args">{cmd().hint}</span>
					</div>
				)}
			</Show>
			<FollowUpDock />
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
