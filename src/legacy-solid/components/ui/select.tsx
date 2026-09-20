/**
 * Select — Kobalte headless select styled to the letter-conversation system:
 * paper trigger with hairline border, no shadow, seal focus ring, and a paper
 * popover (letter bg + hairline + 8px radius). The trigger mirrors the native
 * composer selects' mono/quiet look; the popover reuses the dialog/menu language.
 */
import * as SelectPrimitive from "@kobalte/core/select";
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
	title?: string;
	ariaLabel?: string;
	class?: string;
	itemClass?: string;
	contentClass?: string;
	/** Portal mount target (Solid Portal `mount`). Defaults to body; pass the owning container so
	 * outside-click handlers on that container treat the popover as inside. */
	portalMount?: Node;
}) {
	const selected = () => props.options.find((o) => o.value === props.value) ?? null;
	return (
		<SelectPrimitive.Root<SelectOption>
			options={props.options}
			optionValue="value"
			optionTextValue="label"
			value={selected()}
			onChange={(option) => {
				if (option) props.onChange(option.value);
			}}
			placeholder={props.placeholder ?? "Select…"}
			disallowEmptySelection
			itemComponent={(itemProps) => (
				<SelectPrimitive.Item
					item={itemProps.item}
					class={cn(
						"relative flex cursor-default select-none items-center rounded-[6px] py-1.5 pl-2.5 pr-8 font-mono text-[10px] text-ink-soft outline-none transition-colors focus:bg-paper-hover data-[highlighted]:bg-paper-hover data-[selected]:text-ink",
						props.itemClass,
					)}
				>
					<SelectPrimitive.ItemLabel>{itemProps.item.rawValue.label}</SelectPrimitive.ItemLabel>
					<SelectPrimitive.ItemIndicator class="absolute right-2.5 inline-flex items-center text-seal">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="size-3"
						>
							<path d="M5 12l5 5l10 -10" />
						</svg>
					</SelectPrimitive.ItemIndicator>
				</SelectPrimitive.Item>
			)}
		>
			<SelectPrimitive.Trigger
				title={props.title}
				aria-label={props.ariaLabel}
				class={cn(
					"group inline-flex h-[30px] items-center justify-between gap-2 rounded-[8px] border border-hairline bg-transparent px-2.5 font-mono text-[10px] text-ink-soft outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-letter data-[expanded]:border-seal",
					props.class,
				)}
			>
				<SelectPrimitive.Value<SelectOption> class="truncate">{(state) => state.selectedOption()?.label ?? props.placeholder ?? "Select…"}</SelectPrimitive.Value>
				<SelectPrimitive.Icon class="shrink-0 text-muted transition-transform group-data-[expanded]:rotate-180">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 8 8"
						fill="none"
						stroke="currentColor"
						stroke-width="1.2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-2"
					>
						<path d="M1 2.5 4 5.5 7 2.5" />
					</svg>
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
			<SelectPrimitive.Portal mount={props.portalMount}>
				<SelectPrimitive.Content
					class={cn(
						"z-50 min-w-32 origin-[var(--kb-select-content-transform-origin)] overflow-hidden rounded-[8px] border border-hairline bg-letter p-1 shadow-none animate-in",
						props.contentClass,
					)}
				>
					<SelectPrimitive.Listbox class="max-h-[200px] overflow-y-auto outline-none" />
				</SelectPrimitive.Content>
			</SelectPrimitive.Portal>
		</SelectPrimitive.Root>
	);
}
