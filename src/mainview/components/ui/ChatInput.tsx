import { type JSX, onMount } from "solid-js";
import { shouldSendOnEnter } from "../../lib/composer-input";

export function ChatInput(props: {
	value: string;
	onValueChange: (value: string) => void;
	onEnter: () => void;
	onEscape?: () => void;
	placeholder?: string;
	size?: "sm" | "md";
	variant?: "composer" | "annotation";
	autofocus?: boolean;
	class?: string;
	children?: JSX.Element;
}) {
	let ref: HTMLTextAreaElement | undefined;
	let composing = false;
	onMount(() => {
		if (props.autofocus) ref?.focus();
	});

	const variant = props.variant ?? "composer";
	return (
		<div
			class={
				"composer-field chat-input" + (variant === "annotation" ? " chat-input-annotation" : props.size === "sm" ? " chat-input-sm" : "") + (props.class ? ` ${props.class}` : "")
			}
		>
			{" "}
			<textarea
				ref={(el) => (ref = el)}
				class="composer-input"
				rows={1}
				placeholder={props.placeholder}
				value={props.value}
				onInput={(e) => props.onValueChange((e.currentTarget as HTMLTextAreaElement).value)}
				onCompositionStart={() => {
					composing = true;
				}}
				onCompositionEnd={() => {
					setTimeout(() => {
						composing = false;
					}, 10);
				}}
				onKeyDown={(e) => {
					if (shouldSendOnEnter({ keyCode: e.keyCode, shiftKey: e.shiftKey, repeat: e.repeat, composing, isComposing: e.isComposing })) {
						e.preventDefault();
						props.onEnter();
					} else if (e.key === "Escape" && !props.value.trim()) {
						e.preventDefault();
						props.onEscape?.();
					}
				}}
			/>
			{props.children}
		</div>
	);
}
