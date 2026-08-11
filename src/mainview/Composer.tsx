/**
 * Composer — the input field + dual-mode send/stop button.
 * Presentational: the controller decides what sending/stopping means.
 */
import { ArrowUp, Square } from "lucide-solid";
import type { JSX } from "solid-js";
import { Button } from "./Button";

export function Composer(props: { busy: () => boolean; onSend: (text: string) => void; onStop: () => void }) {
	let input: HTMLInputElement | undefined;

	const send = () => {
		const text = input?.value.trim() ?? "";
		if (!text) return;
		input!.value = "";
		input!.focus();
		props.onSend(text);
	};

	// Enter always sends (queues as follow-up when busy); the button stops when running.
	const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (e) => {
		e.preventDefault();
		send();
	};

	return (
		<form
			class="flex items-center gap-2 bg-white border-[1.5px] border-field rounded-sm pl-1.5 pr-1.5 py-1.5 transition-colors focus-within:border-ink"
			id="composer"
			onSubmit={submit}
		>
			<input
				id="prompt-input"
				ref={input}
				class="flex-1 min-w-0 bg-transparent border-none outline-none font-sans text-[14px] text-ink placeholder:text-ink-soft px-2 py-1.5"
				type="text"
				placeholder="type a prompt …"
				autocomplete="off"
				spellcheck={false}
			/>
			<Button
				variant="solid"
				title={props.busy() ? "stop" : "send"}
				icon={props.busy() ? <Square size={14} /> : <ArrowUp size={14} />}
				onClick={() => (props.busy() ? props.onStop() : send())}
			>
				{props.busy() ? "Stop" : "Send"}
			</Button>
		</form>
	);
}
