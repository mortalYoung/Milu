import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-sans text-sm font-medium transition-[transform,background-color,color,border-color,opacity] duration-[160ms] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				primary: "bg-ink text-on-ink hover:bg-ink/90",
				destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline: "border border-ink/40 bg-transparent hover:bg-hover",
				secondary: "bg-secondary text-secondary-foreground hover:bg-hover",
				ghost: "text-ink hover:bg-hover",
			},
			size: {
				default: "h-10 px-6 py-2",
				sm: "h-9 px-3 text-xs",
				lg: "h-11 px-8",
				icon: "size-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { ref?: Ref<HTMLButtonElement> };

export function Button({ variant, size, className, type = "button", ref, ...rest }: ButtonProps) {
	return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...rest} />;
}

export { buttonVariants };
