import type { PolymorphicProps } from "@kobalte/core";
import * as TextFieldPrimitive from "@kobalte/core/text-field";
import { cva } from "class-variance-authority";
import type { ValidComponent } from "solid-js";
import { mergeProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

type TextFieldRootProps<T extends ValidComponent = "div"> = TextFieldPrimitive.TextFieldRootProps<T> & {
	class?: string | undefined;
};

const TextField = <T extends ValidComponent = "div">(props: PolymorphicProps<T, TextFieldRootProps<T>>) => {
	const [local, others] = splitProps(props as TextFieldRootProps, ["class"]);
	return <TextFieldPrimitive.Root class={cn("flex flex-col gap-1", local.class)} {...others} />;
};

type TextFieldInputProps<T extends ValidComponent = "input"> = TextFieldPrimitive.TextFieldInputProps<T> & {
	class?: string | undefined;
	type?:
		| "button"
		| "checkbox"
		| "color"
		| "date"
		| "datetime-local"
		| "email"
		| "file"
		| "hidden"
		| "image"
		| "month"
		| "number"
		| "password"
		| "radio"
		| "range"
		| "reset"
		| "search"
		| "submit"
		| "tel"
		| "text"
		| "time"
		| "url"
		| "week";
};

const TextFieldInput = <T extends ValidComponent = "input">(rawProps: PolymorphicProps<T, TextFieldInputProps<T>>) => {
	const props = mergeProps<TextFieldInputProps<T>[]>({ type: "text" }, rawProps);
	const [local, others] = splitProps(props as TextFieldInputProps, ["type", "class"]);
	return (
		<TextFieldPrimitive.Input
			type={local.type}
			class={cn(
				"flex h-10 w-full rounded-[10px] border border-input bg-letter px-3 py-2 font-sans text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-seal focus-visible:ring-2 focus-visible:ring-seal/20 disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-seal",
				local.class,
			)}
			{...others}
		/>
	);
};

type TextFieldTextAreaProps<T extends ValidComponent = "textarea"> = TextFieldPrimitive.TextFieldTextAreaProps<T> & { class?: string | undefined };

const TextFieldTextArea = <T extends ValidComponent = "textarea">(props: PolymorphicProps<T, TextFieldTextAreaProps<T>>) => {
	const [local, others] = splitProps(props as TextFieldTextAreaProps, ["class"]);
	return (
		<TextFieldPrimitive.TextArea
			class={cn(
				"flex min-h-[80px] w-full rounded-[10px] border border-input bg-letter px-3 py-2 font-sans text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-seal focus-visible:ring-2 focus-visible:ring-seal/20 disabled:cursor-not-allowed disabled:opacity-50",
				local.class,
			)}
			{...others}
		/>
	);
};

// 表单标签:Public Sans 11px 大写 + 0.6px 正字距(书信方向大写标签)
const labelVariants = cva("font-sans text-[11px] font-medium uppercase tracking-[0.6px] text-muted leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", {
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

type TextFieldLabelProps<T extends ValidComponent = "label"> = TextFieldPrimitive.TextFieldLabelProps<T> & { class?: string | undefined };

const TextFieldLabel = <T extends ValidComponent = "label">(props: PolymorphicProps<T, TextFieldLabelProps<T>>) => {
	const [local, others] = splitProps(props as TextFieldLabelProps, ["class"]);
	return <TextFieldPrimitive.Label class={cn(labelVariants(), local.class)} {...others} />;
};

type TextFieldDescriptionProps<T extends ValidComponent = "div"> = TextFieldPrimitive.TextFieldDescriptionProps<T> & {
	class?: string | undefined;
};

const TextFieldDescription = <T extends ValidComponent = "div">(props: PolymorphicProps<T, TextFieldDescriptionProps<T>>) => {
	const [local, others] = splitProps(props as TextFieldDescriptionProps, ["class"]);
	return <TextFieldPrimitive.Description class={cn(labelVariants({ variant: "description" }), local.class)} {...others} />;
};

type TextFieldErrorMessageProps<T extends ValidComponent = "div"> = TextFieldPrimitive.TextFieldErrorMessageProps<T> & {
	class?: string | undefined;
};

const TextFieldErrorMessage = <T extends ValidComponent = "div">(props: PolymorphicProps<T, TextFieldErrorMessageProps<T>>) => {
	const [local, others] = splitProps(props as TextFieldErrorMessageProps, ["class"]);
	return <TextFieldPrimitive.ErrorMessage class={cn(labelVariants({ variant: "error" }), local.class)} {...others} />;
};

export { TextField, TextFieldDescription, TextFieldErrorMessage, TextFieldInput, TextFieldLabel, TextFieldTextArea };
