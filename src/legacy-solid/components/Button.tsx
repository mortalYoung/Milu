/**
 * Button — a SolidUI component (SolidUI copy-paste, Kobalte headless primitives).
 * Keeps this project's original API on the outside (variant/size/class/icon/children/onClick/disabled/title/type).
 */
import type { JSX } from "solid-js";
import { Button as UIButton } from "./ui/button";

export type ButtonVariant = "default" | "seal" | "destructive" | "outline" | "secondary" | "ghost" | "link";

export function Button(props: {
	variant?: ButtonVariant;
	size?: "default" | "sm" | "lg" | "icon";
	icon?: JSX.Element;
	onClick?: () => void;
	disabled?: boolean;
	title?: string;
	type?: "button" | "submit";
	class?: string;
	children?: JSX.Element;
}) {
	return (
		<UIButton
			variant={props.variant ?? "default"}
			size={props.size ?? "default"}
			class={props.class}
			onClick={props.onClick}
			disabled={props.disabled}
			title={props.title}
			type={props.type ?? "button"}
		>
			{props.icon}
			{props.children}
		</UIButton>
	);
}
