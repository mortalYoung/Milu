/**
 * Composer — the input area (IM interaction, modeled on Feishu):
 * multi-line auto-growing textarea; Enter sends (IME-safe: composition Enter confirms
 * the IME candidate, it must not send), Shift+Enter inserts a newline; the send button
 * appears when there is content; it becomes a stop button while running.
 * Above the input: the workspace chip (read-only). Beside the send button: the context
 * occupancy meter (ContextMeter).
 */
import { ArrowUp, Folder, Square } from "lucide-solid";
import { createEffect, createSignal, type JSX } from "solid-js";
import type { ContextUsage } from "../../shared/rpc";
import { formatWorkspacePath, shouldSendOnEnter } from "../lib/composer-input";
import { Button } from "./Button";
import { ContextMeter } from "./ContextMeter";

/** Auto-grow ceiling (~5 lines); beyond that the textarea scrolls internally. */
const MAX_HEIGHT = 120;

export function Composer(props: {
	busy: () => boolean;
	onSend: (text: string) => void;
	onStop: () => void;
	workspace?: string | null;
	workspaceDefault?: string;
	contextUsage?: ContextUsage | null;
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

	const showSend = () => text().trim() !== "" || props.busy();

	// The chip always shows: the current workspace when set, otherwise the default (project root).
	const workspaceLabel = () => props.workspace ?? props.workspaceDefault ?? "unset";

	return (
		<form class="composer" id="composer" onSubmit={submit}>
			<span class="composer-workspace" title={workspaceLabel()}>
				<Folder size={10} />
				<span class="composer-workspace-path">{formatWorkspacePath(workspaceLabel())}</span>
			</span>
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
		</form>
	);
}
