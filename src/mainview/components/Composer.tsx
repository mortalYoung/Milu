import { ArrowUp, ChevronLeft, ChevronRight, DollarSign, Square, Terminal } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type ChangeEvent, type CompositionEvent, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { CommandDescriptor } from "../../shared/rpc";
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
import { filterMentions } from "../lib/mentions";
import { detectTrigger, parseCommand } from "../lib/trigger";
import { CommandMenu } from "./CommandMenu";
import { ContextMeter } from "./ContextMeter";
import { FollowUpDock } from "./FollowUpDock";
import { PartnerMenu } from "./PartnerMenu";
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
import { Kbd, KbdGroup } from "./ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const MAX_HEIGHT = 120;

export function Composer(props: {
	onSend: (text: string) => void;
	onStop: () => void;
	onShell?: (command: string) => Promise<{ ok: boolean; error?: string; shellId?: string }>;
	onTasks?: () => void;
	hasTasks?: boolean;
	taskRunning?: number;
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
	const [mention, setMention] = useState<{ query: string; span: { start: number; end: number } } | null>(null);
	const [mentionIndex, setMentionIndex] = useState(0);
	const [claimed, setClaimed] = useState<CommandDescriptor | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [shellMode, setShellMode] = useState(false);
	const [modelExpanded, setModelExpanded] = useState(false);
	const [modelTipOpen, setModelTipOpen] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);

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

	const mentionItems = mention ? filterMentions(partners, mention.query) : [];

	useEscapeLayer({
		id: "composer.menu",
		order: ESCAPE_ORDER.composerMenu,
		isOpen: () => menuOpen || claimed != null || mention != null,
		close: () => {
			suppressNextSync.current = true;
			setMenuOpen(false);
			setClaimed(null);
			setMention(null);
		},
	});
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
		if (menuOpen || mention || shellMode || submitting) return null;
		const parsed = parseCommand(text);
		if (!parsed || parsed.rawInput.trim()) return null;
		const cmd = commands.find((c) => c.name === parsed.name);
		return cmd?.hint ? cmd : null;
	})();

	function syncCommandState(value: string, pos: number) {
		if (shellMode) {
			setMenuOpen(false);
			setMention(null);
			lastTriggerKey.current = null;
			return;
		}
		if (claimed) {
			if (!value.startsWith(`/${claimed.name} `)) setClaimed(null);
			setMenuOpen(false);
			setMention(null);
			return;
		}
		const trigger = detectTrigger(value, pos);
		if (trigger?.trigger === "@") {
			const key = `mention:${trigger.query}`;
			if (!mention || lastTriggerKey.current !== key) setMentionIndex(0);
			lastTriggerKey.current = key;
			setMention({ query: trigger.query, span: trigger.span });
			setMenuOpen(false);
			return;
		}
		setMention(null);
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

	function pickPartner(index: number) {
		const partner = mentionItems[index];
		const at = mention;
		if (!partner || !at) return;
		const value = textareaRef.current?.value ?? text;
		const next = `${value.slice(0, at.span.start)}@${partner.name} ${value.slice(at.span.end)}`;
		const caret = at.span.start + partner.name.length + 2;
		setMention(null);
		lastTriggerKey.current = null;
		setText(next);
		composer.change(next);
		queueMicrotask(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(caret, caret);
			resize();
		});
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

		clearText();
		props.onSend(trimmed);
	}

	const submitForm = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		void submit();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		const pickerCount = menuOpen ? menuItems.length : mentionItems.length;
		const pick = (index: number) => (menuOpen ? pickCommand(index) : pickPartner(index));
		if ((menuOpen || mention) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault();
			if (pickerCount > 0) {
				const delta = event.key === "ArrowDown" ? 1 : -1;
				const current = menuOpen ? selectedIndex : mentionIndex;
				const next = (current + delta + pickerCount) % pickerCount;
				if (menuOpen) setSelectedIndex(next);
				else setMentionIndex(next);
			}
			return;
		}
		if (event.key === "Tab" && !event.shiftKey && (menuOpen || mention) && pickerCount > 0) {
			event.preventDefault();
			pick(menuOpen ? selectedIndex : mentionIndex);
			return;
		}
		if (event.key === "Tab" && !event.shiftKey && !menuOpen && text.trim() === "") {
			event.preventDefault();
			setShellMode((v) => !v);
			return;
		}
		if (event.key === "Escape" && shellMode && !menuOpen && mention == null && text.trim() === "") {
			event.preventDefault();
			setShellMode(false);
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
			const pickerOpen = menuOpen || mention != null;
			if (canExecuteLine || !pickerOpen || pickerCount === 0) {
				void submit();
			} else {
				pick(menuOpen ? selectedIndex : mentionIndex);
			}
		}
	};

	const showSend = text.trim() !== "" || busy;
	const showModel = selected != null && agentData.models.length > 0;
	const hasActions = props.hasTasks === true || showModel || metricsData?.contextUsage != null || showSend;
	const modelLabel = agentData.model?.modelId ?? "default model";

	return (
		<form className="composer" id="composer" ref={rootRef} onSubmit={submitForm}>
			{menuOpen && <CommandMenu items={menuItems} selectedIndex={selectedIndex} onPick={pickCommand} onHover={setSelectedIndex} />}
			{mention && <PartnerMenu items={mentionItems} selectedIndex={mentionIndex} onPick={pickPartner} onHover={setMentionIndex} />}
			{commandHint && (
				<div className="composer-command-hint">
					<span className="composer-command-hint-name">/{commandHint.name}</span>
					<span className="composer-command-hint-args">{commandHint.hint}</span>
				</div>
			)}
			<FollowUpDock />
			<div className="composer-row">
				<div className={"composer-box" + (shellMode ? " shell" : "")}>
					<div className="composer-input-layer">
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
							placeholder={shellMode ? "Run a shell command…" : "Type a message…"}
							autoComplete="off"
							spellCheck={false}
							aria-label="Message"
						/>
					</div>
					{hasActions && (
						<div className="composer-actions">
							<button
								type="button"
								className={"composer-icon-btn" + (shellMode ? " on" : "")}
								title="Shell mode (⇥)"
								aria-label="Shell mode"
								aria-pressed={shellMode}
								onClick={() => setShellMode((value) => !value)}
							>
								<DollarSign size={15} />
							</button>
							{props.hasTasks && (
								<div className="composer-task-slot">
									<button type="button" className="composer-icon-btn" title="Tasks" aria-label="Tasks" onClick={() => props.onTasks?.()}>
										<Terminal size={15} />
									</button>
									{(props.taskRunning ?? 0) > 0 && <span className="composer-task-count">{props.taskRunning}</span>}
								</div>
							)}
							<div className="composer-actions-right">
								{selected && agentData.models.length > 0 && (
									<div className={"composer-model" + (modelExpanded ? " expanded" : "")}>
										<Tooltip delayDuration={150} open={modelExpanded ? false : modelTipOpen} onOpenChange={setModelTipOpen}>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="composer-model-toggle"
													aria-expanded={modelExpanded}
													aria-label={modelExpanded ? "Collapse model and effort" : `Model and effort: ${modelLabel} · ${agentData.thinking_level}`}
													onClick={() => {
														if (modelExpanded) {
															setModelMenuOpen(false);
															setModelExpanded(false);
															textareaRef.current?.focus();
														} else {
															setModelExpanded(true);
														}
													}}
												>
													{modelExpanded ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
												</button>
											</TooltipTrigger>
											<TooltipContent side="top" className="font-mono">
												{modelExpanded ? "collapse" : `${modelLabel} · ${agentData.thinking_level}`}
											</TooltipContent>
										</Tooltip>
										<DropdownMenu open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
											<span className="composer-model-slide">
												<span className="composer-model-sep" aria-hidden="true" />
												<DropdownMenuTrigger asChild>
													<button
														type="button"
														className="composer-model-label"
														tabIndex={modelExpanded ? 0 : -1}
														aria-hidden={modelExpanded ? undefined : true}
														title="Model / Effort"
													>
														{modelLabel}

														<span>· {agentData.thinking_level}</span>
													</button>
												</DropdownMenuTrigger>
											</span>
											<DropdownMenuContent
												portalMount={rootRef.current}
												align="end"
												className="min-w-40"
												onCloseAutoFocus={(event) => {
													event.preventDefault();
													textareaRef.current?.focus();
												}}
											>
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="font-mono text-[10px]">Models</DropdownMenuSubTrigger>
													<DropdownMenuSubContent portalMount={rootRef.current} className="min-w-[200px]">
														{agentData.models.map((group) => (
															<DropdownMenuGroup key={group.provider}>
																<DropdownMenuGroupLabel className="font-mono text-[10px]">{group.provider}</DropdownMenuGroupLabel>
																{group.models.map((model) => (
																	<DropdownMenuItem
																		key={model.id}
																		className="whitespace-nowrap font-mono text-[10px] text-ink-soft"
																		onSelect={() => void agent.setModel(selected, { provider: group.provider, modelId: model.id })}
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
													<DropdownMenuSubContent portalMount={rootRef.current} className="min-w-[200px]">
														{agentData.thinking_levels.map((level) => (
															<DropdownMenuItem
																key={level}
																className="whitespace-nowrap font-mono text-[10px] text-ink-soft"
																onSelect={() => void agent.setThinkingLevel(selected, level)}
															>
																<span className="whitespace-nowrap">{level}</span>
																{level === agentData.thinking_level && <span className="ml-auto text-ink">✓</span>}
															</DropdownMenuItem>
														))}
													</DropdownMenuSubContent>
												</DropdownMenuSub>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								)}
								{metricsData?.contextUsage ? <ContextMeter usage={metricsData.contextUsage} /> : null}
								{showSend && (
									<button
										type="button"
										className={"composer-send" + (busy ? " composer-stop" : "")}
										title={busy ? "Stop" : "Send"}
										aria-label={busy ? "Stop" : "Send"}
										onClick={() => (busy ? props.onStop() : void submit())}
									>
										{busy ? <Square size={12} /> : <ArrowUp size={13} />}
									</button>
								)}
							</div>
						</div>
					)}
				</div>
				<div className="composer-tip">
					<MotionConfig reducedMotion="user">
						<AnimatePresence mode="wait" initial={false}>
							<motion.div
								key={shellMode ? "shell" : "chat"}
								className="composer-tip-row"
								initial={{ opacity: 0, x: shellMode ? 10 : -10 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: shellMode ? -10 : 10 }}
								transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
							>
								{shellMode ? (
									<>
										<span className="composer-tip-item">
											<Kbd>⏎</Kbd>运行
										</span>
										<span className="composer-tip-item">
											<KbdGroup>
												<Kbd>⇧</Kbd>
												<Kbd>⏎</Kbd>
											</KbdGroup>
											换行
										</span>
										<span className="composer-tip-item">
											<Kbd>⇥</Kbd>退出模式
										</span>
									</>
								) : (
									<>
										<span className="composer-tip-item">
											<Kbd>/</Kbd>命令
										</span>
										<span className="composer-tip-item">
											<Kbd>@</Kbd>提及其他会话
										</span>
										<span className="composer-tip-item">
											<Kbd>⇥</Kbd>切换模式
										</span>
										<span className="composer-tip-item">
											<Kbd>⏎</Kbd>发送
										</span>
									</>
								)}
							</motion.div>
						</AnimatePresence>
					</MotionConfig>
				</div>
			</div>
		</form>
	);
}
