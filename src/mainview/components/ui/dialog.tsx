import { Dialog as DialogPrimitive } from "radix-ui";
import { type ComponentProps, type CSSProperties, useRef } from "react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogOverlay({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			className={cn(
				"fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
				className,
			)}
			{...rest}
		/>
	);
}

export function DialogContent({
	className,
	children,
	layerClass,
	overlayClass,
	focusClose,
	size,
	style,
	...rest
}: ComponentProps<typeof DialogPrimitive.Content> & {
	layerClass?: string;
	overlayClass?: string;
	focusClose?: boolean;
	/** 设计宽度（可选高度）：不论窗口多窄都收进去，留一条 gutter 透气 —— 弹窗自己滚，不出屏 */
	size?: { w: number; h?: number };
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const fit: CSSProperties = {
		...(size ? { width: `min(${size.w}px, calc(100vw - 2 * var(--page-gutter)))`, maxWidth: "100%" } : {}),
		...(size?.h ? { height: `min(${size.h}px, calc(100vh - 2 * var(--page-gutter)))` } : {}),
		maxHeight: "calc(100vh - 2 * var(--page-gutter))",
	};

	const close = (
		<DialogPrimitive.Close
			ref={closeRef}
			className="absolute right-4 top-4 z-10 rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
				<path d="M18 6l-12 12" />
				<path d="M6 6l12 12" />
			</svg>
			<span className="sr-only">Close</span>
		</DialogPrimitive.Close>
	);

	return (
		<DialogPrimitive.Portal>
			<div className={cn("fixed inset-0 z-50 flex items-start justify-center sm:items-center", layerClass)}>
				<DialogOverlay className={cn(layerClass, overlayClass)} />
				<DialogPrimitive.Content
					className={cn(
						"fixed left-1/2 top-1/2 z-50 grid max-h-screen w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto border bg-card p-6 shadow-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-[12px]",
						className,
						layerClass,
					)}
					style={{ ...fit, ...style }}
					onOpenAutoFocus={
						focusClose
							? (event) => {
									event.preventDefault();
									closeRef.current?.focus();
								}
							: undefined
					}
					{...rest}
				>
					{focusClose ? close : null}
					{children}
					{focusClose ? null : close}
				</DialogPrimitive.Content>
			</div>
		</DialogPrimitive.Portal>
	);
}

export function DialogHeader({ className, ...rest }: ComponentProps<"div">) {
	return <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...rest} />;
}

export function DialogFooter({ className, ...rest }: ComponentProps<"div">) {
	return <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...rest} />;
}

export function DialogTitle({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className={cn("font-sans text-lg font-medium leading-none tracking-tight", className)} {...rest} />;
}

export function DialogDescription({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...rest} />;
}
