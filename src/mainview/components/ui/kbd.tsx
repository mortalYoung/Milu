import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** shadcn's Kbd, mapped onto our tokens: `bg-muted` → our inset tint (`hover`), radius → §1's 3px. */
export function Kbd({ className, ...rest }: ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			className={cn(
				"pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-[3px] bg-hover px-1 font-sans text-xs font-medium text-muted",
				"[&_svg:not([class*='size-'])]:size-3",
				className,
			)}
			{...rest}
		/>
	);
}

export function KbdGroup({ className, ...rest }: ComponentProps<"div">) {
	return <div data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...rest} />;
}
