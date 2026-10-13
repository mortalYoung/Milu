import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Button as UIButton } from "./ui/button";

export type ButtonVariant = "default" | "primary" | "destructive" | "outline" | "secondary" | "ghost";

export function Button(
	props: ButtonHTMLAttributes<HTMLButtonElement> & {
		variant?: ButtonVariant;
		size?: "default" | "sm" | "lg" | "icon";
		icon?: ReactNode;
		class?: string;
		ref?: Ref<HTMLButtonElement>;
	},
) {
	const { variant = "default", size = "default", icon, class: cls, children, ref, type = "button", ...rest } = props;
	return (
		<UIButton ref={ref} variant={variant} size={size} className={cls} type={type} {...rest}>
			{icon}
			{children}
		</UIButton>
	);
}
