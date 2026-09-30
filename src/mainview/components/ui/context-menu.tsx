import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;
export const ContextMenuGroupLabel = ContextMenuPrimitive.Label;

export function ContextMenuContent({
	className,
	size = "md",
	portal = true,
	...rest
}: ComponentProps<typeof ContextMenuPrimitive.Content> & { size?: "sm" | "md"; portal?: boolean }) {
	const content = (
		<ContextMenuPrimitive.Content
			className={cn(
				"z-50 origin-[var(--radix-context-menu-content-transform-origin)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-none animate-in",
				size === "sm" ? "min-w-28 p-0.5" : "min-w-32 p-1",
				className,
			)}
			{...rest}
		/>
	);
	return portal ? <ContextMenuPrimitive.Portal>{content}</ContextMenuPrimitive.Portal> : content;
}

export function ContextMenuItem({ className, size = "md", ...rest }: ComponentProps<typeof ContextMenuPrimitive.Item> & { size?: "sm" | "md" }) {
	return (
		<ContextMenuPrimitive.Item
			className={cn(
				"relative flex cursor-default select-none items-center rounded-md outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				size === "sm" ? "gap-1.5 px-1.5 py-1 text-[10px]" : "gap-2 px-2 py-1.5 text-sm",
				className,
			)}
			{...rest}
		/>
	);
}

export function ContextMenuShortcut({ className, ...rest }: ComponentProps<"span">) {
	return <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...rest} />;
}

export function ContextMenuLabel({ className, ...rest }: ComponentProps<typeof ContextMenuPrimitive.Label>) {
	return <ContextMenuPrimitive.Label className={cn("px-2 py-1.5 text-sm font-medium", className)} {...rest} />;
}

export function ContextMenuSeparator({ className, ...rest }: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
	return <ContextMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} {...rest} />;
}

export function ContextMenuSubTrigger({ className, children, ...rest }: ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
	return (
		<ContextMenuPrimitive.SubTrigger
			className={cn("flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent", className)}
			{...rest}
		>
			{children}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="ml-auto size-4"
			>
				<path d="M9 6l6 6l-6 6" />
			</svg>
		</ContextMenuPrimitive.SubTrigger>
	);
}

export function ContextMenuSubContent({ className, ...rest }: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
	return (
		<ContextMenuPrimitive.SubContent
			className={cn(
				"z-50 min-w-32 origin-[var(--radix-context-menu-content-transform-origin)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-none outline-none animate-in",
				className,
			)}
			{...rest}
		/>
	);
}

export function ContextMenuCheckboxItem({ className, children, ...rest }: ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
	return (
		<ContextMenuPrimitive.CheckboxItem
			className={cn(
				"relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...rest}
		>
			<span className="absolute left-2 flex size-3.5 items-center justify-center">
				<ContextMenuPrimitive.ItemIndicator>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="size-4"
					>
						<path d="M5 12l5 5l10 -10" />
					</svg>
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</ContextMenuPrimitive.CheckboxItem>
	);
}

export function ContextMenuRadioItem({ className, children, ...rest }: ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
	return (
		<ContextMenuPrimitive.RadioItem
			className={cn(
				"relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...rest}
		>
			<span className="absolute left-2 flex size-3.5 items-center justify-center">
				<ContextMenuPrimitive.ItemIndicator>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="size-2 fill-current"
					>
						<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
					</svg>
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</ContextMenuPrimitive.RadioItem>
	);
}
