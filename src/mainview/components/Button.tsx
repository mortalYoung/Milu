/**
 * Button — IM 通用按钮。变体:
 * - solid:石板底(发送/主操作;尺寸由调用方通过 class 控制,如圆形发送钮)
 * - ghost:文字按钮(暖灰 → 墨色)
 * - icon:图标按钮(透明、暖灰图标 → 墨色)
 */
import type { JSX } from "solid-js";

export type ButtonVariant = "solid" | "ghost" | "icon";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
	solid: "bg-slate border-slate text-paper font-bold hover:bg-ink hover:border-ink",
	ghost: "bg-transparent text-ink-soft hover:text-ink px-2 py-1",
	icon: "bg-transparent text-ink-soft hover:text-ink size-8 p-0 rounded-full",
};

export function Button(props: {
	variant?: ButtonVariant;
	icon?: JSX.Element;
	onClick?: () => void;
	disabled?: boolean;
	title?: string;
	type?: "button" | "submit";
	class?: string;
	children?: JSX.Element;
}) {
	return (
		<button
			type={props.type ?? "button"}
			class={"btn " + VARIANT_CLASS[props.variant ?? "solid"] + (props.class ? " " + props.class : "")}
			onClick={props.onClick}
			disabled={props.disabled}
			title={props.title}
		>
			{props.icon}
			{props.children}
		</button>
	);
}
