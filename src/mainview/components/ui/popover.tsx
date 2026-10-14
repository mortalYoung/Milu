import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({ className, portalMount, sideOffset = 6, ...rest }: ComponentProps<typeof PopoverPrimitive.Content> & { portalMount?: HTMLElement | null }) {
	return (
		<PopoverPrimitive.Portal container={portalMount}>
			<PopoverPrimitive.Content
				sideOffset={sideOffset}
				collisionPadding={8}
				className={cn(
					"z-50 origin-[var(--radix-popover-content-transform-origin)] animate-content-hide rounded-[8px] border border-line bg-surface text-ink shadow-none outline-none focus:outline-none data-[state=open]:animate-content-show",
					className,
				)}
				{...rest}
			/>
		</PopoverPrimitive.Portal>
	);
}
