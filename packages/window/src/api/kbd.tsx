import type { ComponentProps } from "react";

export type KbdTone = "default" | "on-ink";

const SKIN: Readonly<Record<KbdTone, string>> = {
	default: "h-5 min-w-5 bg-hover px-1 text-xs text-muted",
	"on-ink": "h-4 min-w-0 bg-canvas/15 px-1 text-[10px] text-canvas/75",
};

export function Kbd(props: ComponentProps<"kbd"> & { readonly tone?: KbdTone }) {
	const { className, tone = "default", ...rest } = props;
	return (
		<kbd
			data-slot="kbd"
			className={`pointer-events-none inline-flex w-fit items-center justify-center gap-1 rounded-[4px] font-sans font-medium select-none ${SKIN[tone]}${className ? ` ${className}` : ""}`}
			{...rest}
		/>
	);
}

export function KbdGroup({ className, ...rest }: ComponentProps<"div">) {
	return <div data-slot="kbd-group" className={`inline-flex items-center gap-1${className ? ` ${className}` : ""}`} {...rest} />;
}
