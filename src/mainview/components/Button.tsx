import type { ReactNode } from "react";
import { Button as UIButton } from "./ui/button";

export type ButtonVariant = "default" | "seal" | "destructive" | "outline" | "secondary" | "ghost" | "link";

export function Button(props: {
	variant?: ButtonVariant;
	size?: "default" | "sm" | "lg" | "icon";
	icon?: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	title?: string;
	type?: "button" | "submit";
	class?: string;
	children?: ReactNode;
}) {
	return (
		<UIButton
			variant={props.variant ?? "default"}
			size={props.size ?? "default"}
			className={props.class}
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
