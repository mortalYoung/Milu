import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function TextField({ className, ...rest }: ComponentProps<"div">) {
	return <div className={cn("flex flex-col gap-1", className)} {...rest} />;
}

export function TextFieldInput({ className, type = "text", variant = "default", ...rest }: ComponentProps<"input"> & { variant?: "default" | "compact" | "quiet" }) {
	return (
		<input
			type={type}
			className={cn(
				variant === "compact"
					? "flex h-[32px] w-full rounded-[6px] border border-line bg-canvas px-3 font-mono text-[13px] text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30"
					: variant === "quiet"
						? "flex h-[32px] w-full rounded-[6px] border border-line bg-canvas px-3 font-sans text-[14px] text-ink placeholder:text-muted focus:outline-none"
						: "flex h-10 w-full rounded-[6px] border border-input bg-surface px-3 py-2 font-sans text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-signal",
				className,
			)}
			{...rest}
		/>
	);
}

export function TextFieldTextArea({ className, ...rest }: ComponentProps<"textarea">) {
	return (
		<textarea
			className={cn(
				"flex min-h-[80px] w-full rounded-[6px] border border-input bg-surface px-3 py-2 font-sans text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...rest}
		/>
	);
}

const labelVariants = cva("font-sans text-[12px] font-medium uppercase tracking-[0.6px] text-muted leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", {
	variants: {
		variant: {
			label: "data-[invalid]:text-destructive",
			description: "font-normal text-muted-foreground",
			error: "text-xs text-destructive",
		},
	},
	defaultVariants: {
		variant: "label",
	},
});

export function TextFieldLabel({ className, ...rest }: ComponentProps<"label">) {
	return <label className={cn(labelVariants(), className)} {...rest} />;
}

export function TextFieldDescription({ className, ...rest }: ComponentProps<"div">) {
	return <div className={cn(labelVariants({ variant: "description" }), className)} {...rest} />;
}

export function TextFieldErrorMessage({ className, ...rest }: ComponentProps<"div">) {
	return <div className={cn(labelVariants({ variant: "error" }), className)} {...rest} />;
}
