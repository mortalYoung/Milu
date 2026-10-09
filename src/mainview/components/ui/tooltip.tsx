import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipProvider = TooltipPrimitive.Provider;

export function TooltipPortal({ children }: { children: React.ReactNode }) {
	return <TooltipPrimitive.Portal>{children}</TooltipPrimitive.Portal>;
}

export function TooltipContent({ className, sideOffset = 4, ...rest }: ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					"z-[60] w-max rounded-[4px] bg-ink px-2 py-1 font-sans text-[10px] leading-none text-canvas select-none",
					"data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:zoom-in-95",
					className,
				)}
				{...rest}
			/>
		</TooltipPrimitive.Portal>
	);
}
