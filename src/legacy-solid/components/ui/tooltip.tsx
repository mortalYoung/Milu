import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as TooltipPrimitive from "@kobalte/core/tooltip";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";
import { cn } from "../../lib/utils";

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipPortal = TooltipPrimitive.Portal;

type TooltipContentProps<T extends ValidComponent = "div"> = TooltipPrimitive.TooltipContentProps<T> & {
	class?: string | undefined;
};

export const TooltipContent = <T extends ValidComponent = "div">(props: PolymorphicProps<T, TooltipContentProps<T>>) => {
	const [, rest] = splitProps(props as TooltipContentProps, ["class"]);
	return (
		<TooltipPrimitive.Content
			class={cn(
				"z-[60] w-max rounded-[4px] bg-ink px-2 py-1 font-sans text-[10px] leading-none text-paper select-none",
				"data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95",
				props.class,
			)}
			{...rest}
		/>
	);
};
