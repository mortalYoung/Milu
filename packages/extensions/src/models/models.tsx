import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { WidgetProps } from "../host/index.ts";
import { Tip } from "../host/tooltip.tsx";
import type { ModelWidgetData } from "./models.ts";

const MENU =
	"z-50 min-w-[200px] rounded-md border border-line-strong bg-surface p-1 shadow-[0_8px_24px_color-mix(in_srgb,var(--ink)_12%,transparent)] data-[state=open]:animate-[menu-in_120ms_cubic-bezier(0.23,1,0.32,1)_both] data-[state=closed]:animate-[menu-out_100ms_cubic-bezier(0.23,1,0.32,1)_both] motion-reduce:animate-none";
const ITEM =
	"flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2 py-1 font-mono text-[10px] whitespace-nowrap text-ink-soft outline-none transition-colors duration-[120ms] data-[highlighted]:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] data-[state=open]:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] motion-reduce:transition-none";
const CHECK = "ml-auto text-ink";

export function ModelsWidget(props: WidgetProps) {
	const data = props.data as ModelWidgetData | null;
	const [expanded, setExpanded] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	if (!data) return null;

	const { host } = props;

	const choose = async (args: unknown): Promise<void> => {
		const session = host.selection.store.getState().selected;
		setMenuOpen(false);
		await host.actions.invoke(args && typeof args === "object" && "level" in args ? "model.effort" : "model.set", session, args);
		await host.sessions.refresh();
		await host.composer.load(session);
	};

	return (
		<div className="inline-flex h-[26px] shrink-0 items-center rounded-full">
			<Tip label={expanded ? "collapse" : `${data.label} · ${data.effort}`}>
				<button
					type="button"
					className={`grid size-[26px] shrink-0 cursor-pointer place-items-center border-0 bg-transparent p-0 text-muted-soft transition-colors duration-150 hover:bg-hover hover:text-ink ${expanded ? "rounded-l-full rounded-r-none" : "rounded-full"}`}
					aria-expanded={expanded}
					aria-label={expanded ? "Collapse model and effort" : `Model and effort: ${data.label} · ${data.effort}`}
					onClick={() => {
						if (expanded) {
							setMenuOpen(false);
							setExpanded(false);
							return;
						}
						setExpanded(true);
					}}
				>
					<Chevron open={expanded} />
				</button>
			</Tip>
			<span
				className={`inline-flex items-center overflow-hidden transition-[max-width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${expanded ? "max-w-[260px]" : "max-w-0"}`}
			>
				<span className="h-4 w-px shrink-0 self-center bg-line" aria-hidden="true" />
				<DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenu.Trigger asChild>
						<button
							type="button"
							className={`inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-l-none rounded-r-full border-0 bg-transparent pr-2.5 pl-2 font-mono text-[10px] whitespace-nowrap text-muted transition-[opacity,background-color,color] duration-[140ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-hover hover:text-ink ${expanded ? "opacity-100" : "opacity-0"}`}
							tabIndex={expanded ? 0 : -1}
							aria-hidden={expanded ? undefined : true}
						>
							{data.label}
							<span>· {data.effort}</span>
						</button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content className={MENU} align="end" sideOffset={6} collisionPadding={8}>
							<DropdownMenu.Sub>
								<DropdownMenu.SubTrigger className={ITEM}>Models</DropdownMenu.SubTrigger>
								<DropdownMenu.Portal>
									<DropdownMenu.SubContent className={MENU} sideOffset={4} collisionPadding={8}>
										{data.groups.map((group) => (
											<DropdownMenu.Group key={group.provider}>
												<DropdownMenu.Label className="px-2 py-1 font-mono text-[10px] text-muted-soft">{group.provider}</DropdownMenu.Label>
												{group.models.map((model) => (
													<DropdownMenu.Item key={model.id} className={ITEM} onSelect={() => void choose({ provider: group.provider, modelId: model.id })}>
														<span>{model.name}</span>
														{group.provider === data.selected?.provider && model.id === data.selected.modelId ? <span className={CHECK}>✓</span> : null}
													</DropdownMenu.Item>
												))}
											</DropdownMenu.Group>
										))}
									</DropdownMenu.SubContent>
								</DropdownMenu.Portal>
							</DropdownMenu.Sub>
							{data.efforts.length > 0 ? (
								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger className={ITEM}>Effort</DropdownMenu.SubTrigger>
									<DropdownMenu.Portal>
										<DropdownMenu.SubContent className={MENU} sideOffset={4} collisionPadding={8}>
											{data.efforts.map((level) => (
												<DropdownMenu.Item key={level} className={ITEM} onSelect={() => void choose({ level })}>
													<span>{level}</span>
													{level === data.effort ? <span className={CHECK}>✓</span> : null}
												</DropdownMenu.Item>
											))}
										</DropdownMenu.SubContent>
									</DropdownMenu.Portal>
								</DropdownMenu.Sub>
							) : null}
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</span>
		</div>
	);
}

function Chevron(props: { open: boolean }) {
	return props.open ? <ChevronRight size={13} /> : <ChevronLeft size={13} />;
}
