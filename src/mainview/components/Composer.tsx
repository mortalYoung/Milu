/**
 * Composer — the input area (direction D · workbench):
 * a bordered field with a seal focus ring; Enter sends (IME-safe: composition Enter confirms
 * the IME candidate, it must not send), Shift+Enter inserts a newline; the send button appears
 * only when there is something to send (text or a run to stop); it becomes a stop button while
 * running. Context occupancy ring sits inside the field. Run settings — workspace/storage path,
 * model, sandbox mode, session metrics — live behind a quiet toggle left of the field: the
 * static composer shows only the pill, and the panel opens on demand (click / outside / Esc
 * to dismiss; sending closes it too).
 */
import { ArrowUp, SlidersHorizontal, Square } from "lucide-solid";
import { createEffect, createSignal, type JSX, onCleanup, Show } from "solid-js";
import type { ContextUsage, SandboxMode, SessionStats } from "../../shared/rpc";
import { formatWorkspacePath, shouldSendOnEnter } from "../lib/composer-input";
import { Button } from "./Button";
import { ContextMeter } from "./ContextMeter";

/** Auto-grow ceiling (~5 lines); beyond that the textarea scrolls internally. */
const MAX_HEIGHT = 120;

/** 1,234 → "1.2k"; 1,234,567 → "1.2M" */
function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(Math.round(n));
}

export function Composer(props: {
	busy: () => boolean;
	onSend: (text: string) => void;
	onStop: () => void;
	/** The workspace set via set_workspace; hidden until then (unset = not needed / not yet set). */
	workspace?: string | null;
	/** The storage path (the agent's own directory; shown alongside the workspace, read-only). */
	storage?: string | null;
	/** The per-partner sandbox mode (select; human-owned). */
	sandboxMode: SandboxMode;
	/** Persist a new per-partner sandbox mode. */
	onSetSandboxMode: (mode: SandboxMode) => void;
	/** The per-partner model selection (null → deepseek default). */
	model: { provider: string; modelId?: string } | null;
	/** Catalog models of every added provider, grouped for the select. */
	models: { provider: string; models: { id: string; name: string }[] }[];
	/** Persist a new per-partner model selection. */
	onSetModel: (model: { provider: string; modelId?: string }) => void;
	contextUsage?: ContextUsage | null;
	/** Session-wide metrics: whole-chat usage totals + averaged TTFT / tok/s. */
	stats?: SessionStats | null;
	/** The selected chat's saved draft (cleared + restored across chat switches, owned by the App). */
	draft: string;
	onDraftChange: (text: string) => void;
}) {
	const [text, setText] = createSignal(props.draft);
	// The draft is per-chat: switching chats swaps the prop, loading the other chat's saved text
	createEffect(() => setText(props.draft));
	let textareaRef: HTMLTextAreaElement | undefined;
	// IME guard: composition Enter picks a candidate, it must not send. The flag outlives
	// renders; clearing is deferred one tick because Safari delivers the closing keydown
	// AFTER compositionend.
	let composing = false;
	const onCompositionStart = () => {
		composing = true;
	};
	const onCompositionEnd = () => {
		setTimeout(() => {
			composing = false;
		}, 10);
	};

	// Run-settings panel: closed by default; the toggle icon left of the field opens it on demand.
	const [panelOpen, setPanelOpen] = createSignal(false);
	let rootRef: HTMLFormElement | undefined;
	// Outside click / Escape close the panel; clicks inside the composer (typing, changing a
	// select) keep it open — only dismissal and the send action close it.
	createEffect(() => {
		if (!panelOpen()) return;
		const onPointerDown = (e: PointerEvent) => {
			if (e.target instanceof Node && rootRef?.contains(e.target)) return;
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

	const send = () => {
		const value = text().trim();
		if (!value) return;
		setText("");
		if (textareaRef) textareaRef.style.height = "";
		setPanelOpen(false); // sending returns to the letter — the settings panel folds back
		props.onSend(value);
	};

	const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (e) => {
		e.preventDefault();
		send();
	};

	const onKeyDown: JSX.EventHandler<HTMLTextAreaElement, KeyboardEvent> = (e) => {
		if (shouldSendOnEnter({ keyCode: e.keyCode, shiftKey: e.shiftKey, repeat: e.repeat, composing, isComposing: e.isComposing })) {
			e.preventDefault();
			send();
		}
	};

	// Send appears only when there is something to send (or a run to stop)
	const showSend = () => text().trim() !== "" || props.busy();

	// Path line: both paths as plain text — workspace/storage are read-only display, so there is
	// no select; the full untruncated paths live in the tooltip.
	const pathLine = () => {
		const parts: JSX.Element[] = [];
		if (props.workspace)
			parts.push(
				<>
					<span class="composer-path-label">ws</span> {formatWorkspacePath(props.workspace, 36)}
				</>,
			);
		if (props.workspace && props.storage) parts.push(<span class="composer-path-sep">·</span>);
		if (props.storage)
			parts.push(
				<>
					<span class="composer-path-label">st</span> {formatWorkspacePath(props.storage, 36)}
				</>,
			);
		return parts;
	};
	const pathTitle = () => [props.workspace && `workspace: ${props.workspace}`, props.storage && `storage: ${props.storage}`].filter(Boolean).join("\n");

	// Session metrics line: whole-chat token totals + averaged timing (the trajectory panel still shows per-turn usage)
	const statsLine = () => {
		const s = props.stats;
		if (!s || !s.usage) return null;
		const u = s.usage;
		const hit = u.input + u.cacheRead > 0 ? Math.round((u.cacheRead / (u.input + u.cacheRead)) * 100) : null;
		const parts = [`in ${formatTokens(u.input)}`, `out ${formatTokens(u.output)}`];
		if (hit != null) parts.push(`cache ${hit}%`);
		if (s.runtime.avgTtftMs != null) parts.push(`ttft ${(s.runtime.avgTtftMs / 1000).toFixed(1)}s`);
		if (s.runtime.avgTps != null) parts.push(`${Math.round(s.runtime.avgTps)} tok/s`);
		return parts.join(" · ");
	};

	// Status row: only while something is happening
	const status = () => (props.busy() ? "writing…" : null);

	return (
		<form class="composer" id="composer" ref={rootRef} onSubmit={submit}>
			{/* The pill, with the run-settings toggle on its left (the send button stays alone on the right) */}
			<div class="composer-row">
				<Button
					variant="ghost"
					size="icon"
					class="composer-toggle"
					title={panelOpen() ? "Hide run settings" : "Run settings"}
					aria-label="Run settings"
					aria-expanded={panelOpen()}
					aria-controls="composer-panel"
					icon={<SlidersHorizontal size={15} />}
					onClick={() => setPanelOpen((v) => !v)}
				/>
				<div class="composer-field">
					<textarea
						id="prompt-input"
						ref={textareaRef}
						value={text()}
						onInput={(e) => {
							setText(e.currentTarget.value);
							props.onDraftChange(e.currentTarget.value);
							resize();
						}}
						onKeyDown={onKeyDown}
						onCompositionStart={onCompositionStart}
						onCompositionEnd={onCompositionEnd}
						class="composer-input"
						rows={1}
						placeholder="Type a message…"
						autocomplete="off"
						spellcheck={false}
						aria-label="Message"
					/>
					{props.contextUsage ? <ContextMeter usage={props.contextUsage} /> : null}
					{showSend() && (
						<Button
							variant={props.busy() ? "outline" : "seal"}
							class="size-[34px] p-0 rounded-full shrink-0"
							title={props.busy() ? "Stop" : "Send"}
							icon={props.busy() ? <Square size={14} /> : <ArrowUp size={14} />}
							onClick={() => (props.busy() ? props.onStop() : send())}
						/>
					)}
				</div>
			</div>
			{/* Run-settings panel: path line (read-only), model / sandbox controls, then status +
			   session metrics as a quiet footnote; on-demand only — closed by outside click, Esc or sending */}
			<Show when={panelOpen()}>
				<div id="composer-panel" class="composer-panel" role="group" aria-label="Run settings">
					{(props.workspace || props.storage) && (
						<div class="composer-panel-path">
							<span class="composer-path" title={pathTitle()}>
								{pathLine()}
							</span>
						</div>
					)}
					<div class="composer-panel-row">
						{props.models.length > 0 && (
							<select
								class="composer-model"
								title="Model (per partner)"
								value={props.model?.modelId ? `${props.model.provider}/${props.model.modelId}` : ""}
								onChange={(e) => {
									const value = e.currentTarget.value;
									const [provider, modelId] = value.split("/");
									props.onSetModel({ provider, modelId: modelId || undefined });
								}}
							>
								{/* No "default" option: an unpinned model leaves the select blank — honest,
								   the provider default is in effect and pinning happens via the options below */}
								{props.models.map((g) => (
									<optgroup label={g.provider}>
										{g.models.map((m) => (
											<option value={`${g.provider}/${m.id}`} title={`${g.provider}/${m.id}`}>
												{m.name}
											</option>
										))}
									</optgroup>
								))}
							</select>
						)}
						<select
							class="composer-sandbox"
							title="Sandbox mode (file writes)"
							value={props.sandboxMode}
							onChange={(e) => props.onSetSandboxMode(e.currentTarget.value as SandboxMode)}
						>
							<option value="read-only">read-only</option>
							<option value="workspace-write">workspace-write</option>
							<option value="danger-full-access">full access</option>
						</select>
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
