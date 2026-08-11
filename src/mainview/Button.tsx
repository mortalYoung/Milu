/**
 * Button — FT masthead style, measured from ft.com `role="button"` elements.
 *
 * Variants observed on the site:
 * - solid  (Subscribe): slate #262A33 bg, white 12px/700, 28px tall, 2px
 *   radius, 1px transparent border reserved for hover
 * - salmon (Explore subscriptions): salmon #FCD0B1 bg, slate #262A33 text,
 *   16px editorial CTA
 * - ghost  (text buttons): transparent, warm-gray text → ink on hover
 * - icon   (search/menu toggles): transparent, 40×40 touch target, ink icon
 */
import type { JSX } from "solid-js";

export type ButtonVariant = "solid" | "salmon" | "ghost" | "icon";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
	solid: "bg-slate text-paper text-[12px] font-bold h-7 px-2 rounded-sm border border-transparent hover:bg-ink",
	salmon: "bg-salmon text-slate text-[16px] px-6 py-2 hover:bg-salmon/80",
	ghost: "bg-transparent text-ink-soft hover:text-ink px-2 py-1",
	icon: "bg-transparent text-ink size-10",
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
