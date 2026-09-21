import { ArrowUp, SlidersHorizontal, Square, Terminal } from "lucide-react";
import { type ChangeEvent, type CompositionEvent, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { CommandDescriptor, SandboxMode } from "../../shared/rpc";
import { filterCommands } from "../lib/commands";
import { shouldSendOnEnter } from "../lib/composer-input";
import { EMPTY_STATUS, useAgentStatus } from "../lib/contexts/agent-status-context";
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
	onTasks?: () => void;
	hasTasks?: boolean;
	taskRunning?: number;
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

	const selected = useStore(session.store, (state) => state.selected);
	const agentSnapshot = useStore(agent.store, (state) => state.snapshot);
	const writing = useStore(agent.store, (state) => state.writing);
	const partners = useStore(session.store, (state) => state.partners);
	const pendingPrefill = useStore(composer.store, (state) => state.pendingPrefill);
	const panelOpen = useStore(composer.store, (state) => state.panelOpen);
	const metricsData = useStore(metrics.store, (state) => state.data);
	const commands = useStore(commandDirectory.store, (state) => state.commands);
	const skillList = useStore(skillDirectory.store, (state) => state.skills);
	const settingsSnapshot = useStore(settings.store, (state) => state.snapshot);

	const agentData = selected ? agentSnapshot : EMPTY_STATUS;
	const busy = selected ? (writing[selected] ?? partners.find((p) => p.name === selected)?.writing ?? false) : false;
	const shellContinuous = settingsSnapshot.settings?.shellContinuous ?? true;

	const [text, setText] = useState("");
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuQuery, setMenuQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [claimed, setClaimed] = useState<CommandDescriptor | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [shellMode, setShellMode] = useState(false);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const rootRef = useRef<HTMLFormElement>(null);
	const composing = useRef(false);
	const pendingImeFix = useRef<{ data: string; fixed: string; cursor: number } | null>(null);
	const lastTriggerKey = useRef<string | null>(null);
	const suppressNextSync = useRef(false);

	useEffect(() => {
		const request = pendingPrefill;
		if (!request || request.partner !== selected) return;
		composer.consumePrefill(request.id);
		setText(request.text);
		composer.change(request.text);
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(request.text.length, request.text.length);
			syncCommandState(request.text, request.text.length);
			resize();
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pendingPrefill, selected]);

	useEffect(() => {
		const value = selected ? (composer.store.getState().drafts[selected] ?? "") : "";
		setText(value);
		setMenuOpen(false);
		setClaimed(null);
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.style.height = "";
			resize();
			focusEnd();
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selected]);

	const menuItems = (() => {
		const matched = filterCommands(commands, menuQuery);
		const skillItems = filterCommands(
			skillList
				.filter((skill) => skill.userInvocable)
				.map(
					(skill): CommandDescriptor => ({
						name: `skill:${skill.name}`,
						description: skill.description,
						kind: "execute",
						category: "skill",
					}),
				),
			menuQuery,
		);
		return [...matched, ...skillItems];
	})();

	useEscapeLayer({
		id: "composer.menu",
		order: ESCAPE_ORDER.composerMenu,
		isOpen: () => menuOpen || claimed != null,
		close: () => {
			suppressNextSync.current = true;
			setMenuOpen(false);
			setClaimed(null);
		},
	});
	useEscapeLayer({
		id: "composer.panel",
		order: ESCAPE_ORDER.composerPanel,
		isOpen: () => composer.store.getState().panelOpen,
		close: () => composer.setPanelOpen(false),
	});

	useEffect(() => {
		if (!panelOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Node && rootRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest('[role="menu"], [data-radix-popper-content-wrapper]')) return;
			composer.setPanelOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [panelOpen, composer]);

	function resize() {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
	}

	function focusEnd() {
		const el = textareaRef.current;
		if (!el) return;
		el.focus();
		const len = el.value.length;
		el.setSelectionRange(len, len);
	}

	function clearText() {
		setText("");
		composer.change("");
		if (textareaRef.current) textareaRef.current.style.height = "";
	}

	const commandHint = (() => {
		if (menuOpen || panelOpen || shellMode || submitting) return null;
		const parsed = parseCommand(text);
		if (!parsed || parsed.rawInput.trim()) return null;
		const cmd = commands.find((c) => c.name === parsed.name);
		return cmd?.hint ? cmd : null;
	})();

	function syncCommandState(value: string, pos: number) {
		if (shellMode) {
			setMenuOpen(false);
			lastTriggerKey.current = null;
			return;
		}
		if (claimed) {
			if (!value.startsWith(`/${claimed.name} `)) setClaimed(null);
			setMenuOpen(false);
			return;
		}
		const trigger = detectTrigger(value, pos);
		if (trigger?.trigger === "/" && trigger.position === "leading") {
			const key = `${trigger.position}:${trigger.query}`;
			if (!menuOpen || lastTriggerKey.current !== key) setSelectedIndex(0);
			lastTriggerKey.current = key;
			setMenuQuery(trigger.query);
			setMenuOpen(true);
		} else {
			setMenuOpen(false);
			lastTriggerKey.current = null;
		}
	}

	const onCompositionStart = () => {
		composing.current = true;
	};

	const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
		const data = event.data ?? "";
		if (/^[A-Za-z\s]+$/.test(data) && data !== data.replace(/\s/g, "")) {
			const el = textareaRef.current;
			if (el) {
				pendingImeFix.current = { data, fixed: data.replace(/\s/g, ""), cursor: el.selectionStart ?? el.value.length };
			}
			setTimeout(() => {
				const fix = pendingImeFix.current;
				const target = textareaRef.current;
				if (!fix || !target) return;
				const value = target.value;
				const start = Math.max(0, fix.cursor - fix.data.length);
				if (value.slice(start, start + fix.data.length) !== fix.data) return;
				const next = value.slice(0, start) + fix.fixed + value.slice(start + fix.data.length);
				pendingImeFix.current = null;
				setText(next);
				composer.change(next);
				target.value = next;
				const pos = start + fix.fixed.length;
				target.setSelectionRange(pos, pos);
				resize();
			}, 0);
		}
		setTimeout(() => {
			composing.current = false;
		}, 10);
	};

	async function executeCommand(line: string, consumed = false) {
		if (submitting) return;
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
		const next = `/${cmd.name} `;
		setText(next);
		composer.change(next);
		setClaimed(cmd);
		setMenuOpen(false);
		queueMicrotask(focusEnd);
	}

	async function executeSkill(name: string, hint?: string) {
		if (submitting) return;
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
		if (submitting) return;
		const trimmed = text.trim();
		if (!trimmed) return;
		setSubmitting(true);
		setMenuOpen(false);
		setClaimed(null);
		clearText();
		if (!shellContinuous) setShellMode(false);
		try {
			await props.onShell?.(trimmed);
		} finally {
			setSubmitting(false);
		}
	}

	function pickCommand(index: number) {
		const item = menuItems[index];
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
		if (submitting) return;
		const value = text;
		const trimmed = value.trim();
		if (!trimmed) return;
		if (shellMode) {
			await executeShell();
			return;
		}
		const skillMatch = /^\/skill:([a-z0-9_-]+)(?:\s+(.*))?$/.exec(trimmed);
		if (skillMatch) {
			composer.setPanelOpen(false);
			await executeSkill(skillMatch[1]!, skillMatch[2]?.trim() || undefined);
			return;
		}
		const parsed = parseCommand(trimmed);
		const cmd = parsed ? commands.find((c) => c.name === parsed.name) : undefined;

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

		composer.setPanelOpen(false);
		clearText();
		props.onSend(trimmed);
	}

	const submitForm = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		void submit();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault();
			if (menuItems.length > 0) {
				const delta = event.key === "ArrowDown" ? 1 : -1;
				setSelectedIndex((i) => (i + delta + menuItems.length) % menuItems.length);
			}
			return;
		}
		if (event.key === "Tab" && !event.shiftKey && menuOpen && menuItems.length > 0) {
			event.preventDefault();
			pickCommand(selectedIndex);
			return;
		}
		if (event.key === "Tab" && !event.shiftKey && !menuOpen && text.trim() === "") {
			event.preventDefault();
			setShellMode((v) => !v);
			return;
		}
		if (event.key === " " && !event.shiftKey) {
			const parsed = parseCommand(text);
			if (parsed && !parsed.rawInput.trim()) {
				const cmd = commands.find((c) => c.name === parsed.name && c.kind === "leadingInput");
				if (cmd) {
					event.preventDefault();
					claimLeading(cmd);
					return;
				}
			}
		}
		if (shouldSendOnEnter({ keyCode: event.keyCode, shiftKey: event.shiftKey, repeat: event.repeat, composing: composing.current, isComposing: event.nativeEvent.isComposing })) {
			event.preventDefault();
			const parsed = parseCommand(text);
			const exact = parsed ? commands.find((c) => c.name === parsed.name) : undefined;
			const canExecuteLine = exact && (exact.kind === "execute" || (exact.kind === "leadingInput" && parsed!.rawInput.trim()));
			if (canExecuteLine || !menuOpen || menuItems.length === 0) {
				void submit();
			} else {
				pickCommand(selectedIndex);
			}
		}
	};

	const showSend = text.trim() !== "" || busy;

	const stats = metricsData?.stats ?? null;
	const statsLine = (() => {
		if (!stats || !stats.usage) return null;
		const usage = stats.usage;
		const billed = usage.input + usage.cacheRead + usage.cacheWrite;
		const hit = billed > 0 ? (usage.cacheRead / billed) * 100 : null;
		const parts = [`in ${formatTokens(usage.input)} tok`, `out ${formatTokens(usage.output)} tok`];
		if (hit != null) parts.push(`cache ${hit.toFixed(2)}%`);
		if (stats.runtime.avgTtftMs != null) parts.push(`ttft ${(stats.runtime.avgTtftMs / 1000).toFixed(1)}s`);
		if (stats.runtime.avgTps != null) parts.push(`${Math.round(stats.runtime.avgTps)} tok/s`);
		return parts.join(" · ");
	})();

	const modelLabel = agentData.model?.modelId ?? "default model";

	return (
		<form className="composer" id="composer" ref={rootRef} onSubmit={submitForm}>
			{menuOpen && <CommandMenu items={menuItems} selectedIndex={selectedIndex} onPick={pickCommand} onHover={setSelectedIndex} />}
			{commandHint && (
				<div className="composer-command-hint">
					<span className="composer-command-hint-name">/{commandHint.name}</span>
					<span className="composer-command-hint-args">{commandHint.hint}</span>
				</div>
			)}
			<FollowUpDock />
			<div className="composer-row">
				<Button
					variant="ghost"
					size="icon"
					class="composer-toggle"
					title={panelOpen ? "Hide runtime context" : "Runtime context"}
					aria-label="Runtime context"
					aria-expanded={panelOpen}
					aria-controls="composer-panel"
					icon={<SlidersHorizontal size={15} />}
					onClick={() => composer.setPanelOpen(!panelOpen)}
				/>
				{props.hasTasks && (
					<div className="composer-task-slot">
						<Button variant="ghost" size="icon" class="composer-toggle" title="Tasks" aria-label="Tasks" icon={<Terminal size={15} />} onClick={() => props.onTasks?.()} />
						{(props.taskRunning ?? 0) > 0 && <span className="composer-task-count">{props.taskRunning}</span>}
					</div>
				)}
				<div className={"composer-field" + (shellMode ? " shell" : "")}>
					{shellMode && (
						<span className="composer-shell-prefix" aria-hidden="true">
							$
						</span>
					)}
					{shellMode && <span className="composer-shell-tag">shell</span>}
					<textarea
						id="prompt-input"
						ref={textareaRef}
						value={text}
						onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
							const el = event.currentTarget;
							const value = el.value;
							setText(value);
							composer.change(value);
							const pos = el.selectionStart ?? value.length;
							suppressNextSync.current = false;
							syncCommandState(value, pos);
							resize();
						}}
						onKeyDown={onKeyDown}
						onKeyUp={(event) => {
							if (suppressNextSync.current) return;
							const el = event.currentTarget;
							const pos = el.selectionStart ?? el.value.length;
							syncCommandState(el.value, pos);
						}}
						onSelect={(event) => {
							if (suppressNextSync.current) return;
							const el = event.currentTarget;
							const pos = el.selectionStart ?? el.value.length;
							syncCommandState(el.value, pos);
						}}
						onCompositionStart={onCompositionStart}
						onCompositionEnd={onCompositionEnd}
						className="composer-input"
						rows={1}
						placeholder="Type a message…"
						autoComplete="off"
						spellCheck={false}
						aria-label="Message"
					/>
					{metricsData?.contextUsage ? <ContextMeter usage={metricsData.contextUsage} /> : null}
					{showSend && (
						<Button
							variant={busy ? "outline" : "seal"}
							class={`size-[34px] p-0 rounded-full shrink-0 ${busy ? "composer-stop" : ""}`}
							title={busy ? "Stop" : "Send"}
							icon={busy ? <Square size={14} /> : <ArrowUp size={14} />}
							onClick={() => (busy ? props.onStop() : void submit())}
						/>
					)}
				</div>
			</div>
			{panelOpen && (
				<div id="composer-panel" className="composer-panel" role="group" aria-label="Runtime context">
					{(agentData.workspace_path || agentData.storage_path) && (
						<div className="composer-panel-path">
							<span
								className="composer-path"
								title={[agentData.workspace_path && `workspace: ${agentData.workspace_path}`, agentData.storage_path && `storage: ${agentData.storage_path}`]
									.filter(Boolean)
									.join("\n")}
							>
								{agentData.workspace_path && (
									<EditorPathButton label="ws" path={agentData.workspace_path} class="-mx-1 px-1" editors={props.editors} onOpenPath={props.onOpenPath} />
								)}
								{agentData.workspace_path && agentData.storage_path && <span className="composer-path-sep">·</span>}
								{agentData.storage_path && <EditorPathButton label="st" path={agentData.storage_path} class="-mx-1 px-1" editors={props.editors} onOpenPath={props.onOpenPath} />}
							</span>
						</div>
					)}
					<div className="composer-panel-row">
						{agentData.models.length > 0 && (
							<DropdownMenu>
								<DropdownMenuTrigger
									className="shrink-0 min-w-0 max-w-[200px] inline-flex h-[30px] items-center justify-between gap-2 rounded-[8px] border border-hairline bg-transparent px-2.5 font-mono text-[10px] text-ink-soft outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-letter data-[state=open]:border-seal"
									title="Model / Effort (per partner)"
								>
									<span className="truncate">
										{modelLabel}·{agentData.thinking_level}
									</span>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 8 8"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.2"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="size-2 shrink-0 text-muted"
									>
										<path d="M1 2.5 4 5.5 7 2.5" />
									</svg>
								</DropdownMenuTrigger>
								<DropdownMenuContent portalMount={rootRef.current} className="min-w-40">
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="font-mono text-[10px]">Models</DropdownMenuSubTrigger>
										<DropdownMenuSubContent portalMount={rootRef.current}>
											{agentData.models.map((group) => (
												<DropdownMenuGroup key={group.provider}>
													<DropdownMenuGroupLabel className="font-mono text-[10px]">{group.provider}</DropdownMenuGroupLabel>
													{group.models.map((model) => (
														<DropdownMenuItem
															key={model.id}
															className="font-mono text-[10px] text-ink-soft"
															onSelect={() => void agent.mutateModel({ provider: group.provider, modelId: model.id })}
														>
															{model.name}
														</DropdownMenuItem>
													))}
												</DropdownMenuGroup>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="font-mono text-[10px]">Effort</DropdownMenuSubTrigger>
										<DropdownMenuSubContent portalMount={rootRef.current}>
											{agentData.thinking_levels.map((level) => (
												<DropdownMenuItem key={level} className="font-mono text-[10px] text-ink-soft" onSelect={() => void agent.mutateThinkingLevel(level)}>
													<span>{level}</span>
													{level === agentData.thinking_level && <span className="ml-auto text-seal">✓</span>}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
						<Select
							class="shrink-0"
							title="Sandbox mode (file writes)"
							ariaLabel="Sandbox mode"
							value={agentData.sandbox_mode}
							portalMount={rootRef.current}
							onChange={(value) => void agent.mutateSandboxMode(value as SandboxMode)}
							options={[
								{ value: "read-only", label: "read-only" },
								{ value: "workspace-write", label: "workspace-write" },
								{ value: "danger-full-access", label: "full access" },
							]}
						/>
					</div>
					{(busy || statsLine) && (
						<div className="composer-panel-foot">
							{busy && (
								<span className="composer-status">
									<span className="composer-status-dot" />
									<span>writing…</span>
								</span>
							)}
							{statsLine && <span className="composer-stats">{statsLine}</span>}
						</div>
					)}
				</div>
			)}
		</form>
	);
}
