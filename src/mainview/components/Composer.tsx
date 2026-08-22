/**
 * Composer — the input area (direction D · workbench):
 * a bordered field with a seal focus ring; Enter sends (IME-safe: composition Enter confirms
 * the IME candidate, it must not send), Shift+Enter inserts a newline; the send button appears
 * only when there is something to send (text or a run to stop); it becomes a stop button while
 * running. Context occupancy ring sits inside the field. Meta — workspace (folder icon + path)
 * above, session metrics below — unfolds while the field is focused; a status row above
 * the field shows writing / queued while something is happening.
 */
import { ArrowUp, Folder, Square } from "lucide-solid";
import { createEffect, createSignal, type JSX } from "solid-js";
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
	/** The per-partner sandbox mode (select; human-owned). */
	sandboxMode: SandboxMode;
	/** Persist a new per-partner sandbox mode. */
	onSetSandboxMode: (mode: SandboxMode) => void;
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
		<form class="composer" id="composer" onSubmit={submit}>
			{/* Workspace: folder icon + path, unfolds with focus (unset = hidden entirely) */}
			{/* Meta row: workspace chip (left) + live status and sandbox-mode select (right), flexed on one line */}
			<div class="composer-meta">
				{props.workspace && (
					<span class="composer-workspace" title={props.workspace}>
						<Folder size={10} />
						<span class="composer-workspace-path">{formatWorkspacePath(props.workspace)}</span>
					</span>
				)}
				<span class="composer-meta-right">
					{status() && (
						<span class="composer-status">
							<span class="composer-status-dot" />
							<span>{status()}</span>
						</span>
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
				</span>
			</div>
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
			{/* Session metrics footnote, unfolds with focus */}
			{statsLine() && <div class="composer-meta composer-stats">{statsLine()}</div>}
		</form>
	);
}
