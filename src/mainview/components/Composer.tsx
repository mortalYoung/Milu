/**
 * Composer — the input area (IM interaction, modeled on Feishu):
 * rounded input; the send button appears when there is content; it becomes a stop button while running.
 */
import { ArrowUp, Square } from "lucide-solid";
import { createSignal, type JSX } from "solid-js";
import { Button } from "./Button";

export function Composer(props: { busy: () => boolean; onSend: (text: string) => void; onStop: () => void; workspace?: string | null }) {
	const [text, setText] = createSignal("");

	const send = () => {
		const value = text().trim();
		if (!value) return;
		setText("");
		props.onSend(value);
	};

	const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (e) => {
		e.preventDefault();
		send();
	};

	const showSend = () => text().trim() !== "" || props.busy();

	return (
		<form class="composer" id="composer" onSubmit={submit}>
			{props.workspace && (
				<span class="composer-workspace" title={props.workspace}>
					workspace: {props.workspace}
				</span>
			)}
			<div class="composer-field">
				<input
					id="prompt-input"
					value={text()}
					onInput={(e) => setText(e.currentTarget.value)}
					class="composer-input"
					type="text"
					placeholder="Type a message…"
					autocomplete="off"
					spellcheck={false}
				/>
				{showSend() && (
					<Button
						variant={props.busy() ? "outline" : "seal"}
						class="size-[34px] p-0 rounded-full"
						title={props.busy() ? "Stop" : "Send"}
						icon={props.busy() ? <Square size={14} /> : <ArrowUp size={14} />}
						onClick={() => (props.busy() ? props.onStop() : send())}
					/>
				)}
			</div>
		</form>
	);
}
