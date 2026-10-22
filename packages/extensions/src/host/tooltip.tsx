import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import "./tooltip.css";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tip(props: { label?: ReactNode; side?: "top" | "right" | "bottom" | "left"; children: ReactNode }) {
	if (props.label === undefined || props.label === null || props.label === "") return <>{props.children}</>;
	return (
		<TooltipPrimitive.Root delayDuration={120}>
			<TooltipPrimitive.Trigger asChild>{props.children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content className="milu-tip" side={props.side ?? "top"} sideOffset={4} collisionPadding={8}>
					{props.label}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}
