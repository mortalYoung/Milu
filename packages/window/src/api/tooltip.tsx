import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tip(props: { label?: ReactNode; side?: "top" | "right" | "bottom" | "left"; children: ReactNode }) {
	if (props.label === undefined || props.label === null || props.label === "") return <>{props.children}</>;
	return (
		<TooltipPrimitive.Root delayDuration={120}>
			<TooltipPrimitive.Trigger asChild>{props.children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					className="z-[90] max-w-[340px] rounded-[4px] bg-ink px-2 py-1 font-sans text-[10px] leading-[1.5] whitespace-pre-line [overflow-wrap:anywhere] text-canvas shadow-[0_6px_18px_color-mix(in_srgb,var(--ink)_18%,transparent)] select-none"
					side={props.side ?? "top"}
					sideOffset={4}
					collisionPadding={8}
				>
					{props.label}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}
