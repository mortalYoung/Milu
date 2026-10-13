import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

export interface SelectOption {
	value: string;
	label: string;
}

export function Select(props: {
	value: string;
	onChange: (value: string) => void;
	options: SelectOption[];
	placeholder?: string;
	ariaLabel?: string;
	class?: string;
	itemClass?: string;
	contentClass?: string;
	portalMount?: Element | DocumentFragment | null;
}) {
	return (
		<SelectPrimitive.Root value={props.value} onValueChange={props.onChange}>
			<SelectPrimitive.Trigger
				aria-label={props.ariaLabel}
				className={cn(
					"group inline-flex h-[30px] items-center justify-between gap-2 rounded-[6px] border border-line bg-transparent px-2.5 font-mono text-[10px] text-ink-soft outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface data-[state=open]:border-ink",
					props.class,
				)}
			>
				<SelectPrimitive.Value placeholder={props.placeholder ?? "Select…"} />
				<SelectPrimitive.Icon className="shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 8 8"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="size-2"
					>
						<path d="M1 2.5 4 5.5 7 2.5" />
					</svg>
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
			<SelectPrimitive.Portal container={props.portalMount}>
				<SelectPrimitive.Content
					position="popper"
					sideOffset={4}
					className={cn(
						"z-50 min-w-32 origin-[var(--radix-select-content-transform-origin)] overflow-hidden rounded-[6px] border border-line bg-surface p-1 shadow-none animate-in",
						props.contentClass,
					)}
				>
					<SelectPrimitive.Viewport className="max-h-[200px] overflow-y-auto outline-none">
						{props.options.map((option) => (
							<SelectPrimitive.Item
								key={option.value}
								value={option.value}
								className={cn(
									"relative flex cursor-default select-none items-center rounded-[6px] py-1.5 pl-2.5 pr-8 font-mono text-[10px] text-ink-soft outline-none transition-colors focus:bg-hover data-[highlighted]:bg-hover data-[state=checked]:text-ink",
									props.itemClass,
								)}
							>
								<SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
								<SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex items-center text-ink">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="size-3"
									>
										<path d="M5 12l5 5l10 -10" />
									</svg>
								</SelectPrimitive.ItemIndicator>
							</SelectPrimitive.Item>
						))}
					</SelectPrimitive.Viewport>
				</SelectPrimitive.Content>
			</SelectPrimitive.Portal>
		</SelectPrimitive.Root>
	);
}
