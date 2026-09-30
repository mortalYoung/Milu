import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownMenuGroupLabel = DropdownMenuPrimitive.Label;

export function DropdownMenuContent({
	className,
	portalMount,
	sideOffset = 4,
	...rest
}: ComponentProps<typeof DropdownMenuPrimitive.Content> & { portalMount?: HTMLElement | null }) {
	return (
		<DropdownMenuPrimitive.Portal container={portalMount}>
			<DropdownMenuPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					"z-50 min-w-32 origin-[var(--radix-dropdown-menu-content-transform-origin)] animate-content-hide rounded-md border bg-popover p-1 text-popover-foreground shadow-none outline-none focus:outline-none focus-visible:outline-none data-[state=open]:animate-content-show",
					className,
				)}
				{...rest}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

export function DropdownMenuItem({ className, ...rest }: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
	return (
		<DropdownMenuPrimitive.Item
			className={cn(
				"relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...rest}
		/>
	);
}

export function DropdownMenuShortcut({ className, ...rest }: ComponentProps<"span">) {
	return <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...rest} />;
}

export function DropdownMenuLabel({ className, ...rest }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
	return <DropdownMenuPrimitive.Label className={cn("px-2 py-1.5 text-sm font-medium", className)} {...rest} />;
}

export function DropdownMenuSeparator({ className, ...rest }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
	return <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} {...rest} />;
}

export function DropdownMenuSubTrigger({ className, children, ...rest }: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
	return (
		<DropdownMenuPrimitive.SubTrigger
			className={cn(
				"flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm outline-none focus-visible:outline-none focus:bg-accent data-[state=open]:bg-accent",
				className,
			)}
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
		</DropdownMenuPrimitive.SubTrigger>
	);
}

export function DropdownMenuSubContent({ className, portalMount, ...rest }: ComponentProps<typeof DropdownMenuPrimitive.SubContent> & { portalMount?: HTMLElement | null }) {
	return (
		<DropdownMenuPrimitive.Portal container={portalMount}>
			<DropdownMenuPrimitive.SubContent
				className={cn(
					"z-50 min-w-32 origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-none outline-none focus:outline-none focus-visible:outline-none animate-in",
					className,
				)}
				{...rest}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

export function DropdownMenuCheckboxItem({ className, children, ...rest }: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
	return (
		<DropdownMenuPrimitive.CheckboxItem
			className={cn(
				"relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...rest}
		>
			<span className="absolute left-2 flex size-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
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
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
}

export function DropdownMenuRadioItem({ className, children, ...rest }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
	return (
		<DropdownMenuPrimitive.RadioItem
			className={cn(
				"relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...rest}
		>
			<span className="absolute left-2 flex size-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
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
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.RadioItem>
	);
}
