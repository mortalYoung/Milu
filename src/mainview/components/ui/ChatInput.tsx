import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
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
	children?: ReactNode;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);

	useEffect(() => {
		if (props.autofocus) ref.current?.focus();
	}, [props.autofocus]);

	const variant = props.variant ?? "composer";

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (shouldSendOnEnter({ keyCode: event.keyCode, shiftKey: event.shiftKey, repeat: event.repeat, composing: composing.current, isComposing: event.nativeEvent.isComposing })) {
			event.preventDefault();
			props.onEnter();
		} else if (event.key === "Escape" && !props.value.trim()) {
			event.preventDefault();
			props.onEscape?.();
		}
	};

	return (
		<div
			className={
				"composer-field chat-input" + (variant === "annotation" ? " chat-input-annotation" : props.size === "sm" ? " chat-input-sm" : "") + (props.class ? ` ${props.class}` : "")
			}
		>
			{" "}
			<textarea
				ref={ref}
				className="composer-input"
				rows={1}
				placeholder={props.placeholder}
				value={props.value}
				onChange={(event) => props.onValueChange(event.currentTarget.value)}
				onCompositionStart={() => {
					composing.current = true;
				}}
				onCompositionEnd={() => {
					setTimeout(() => {
						composing.current = false;
					}, 10);
				}}
				onKeyDown={onKeyDown}
			/>
			{props.children}
		</div>
	);
}
