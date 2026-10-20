import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";

import type { WidgetProps } from "../host/index.ts";
import type { ModelWidgetData } from "./models.ts";

import "./models.css";

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
		<div className={`composer-model${expanded ? " expanded" : ""}`}>
			<button
				type="button"
				className="composer-model-toggle"
				aria-expanded={expanded}
				aria-label={expanded ? "Collapse model and effort" : `Model and effort: ${data.label} · ${data.effort}`}
				title={expanded ? "collapse" : `${data.label} · ${data.effort}`}
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
			<span className="composer-model-slide">
				<span className="composer-model-sep" aria-hidden="true" />
				<DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenu.Trigger asChild>
						<button type="button" className="composer-model-label" tabIndex={expanded ? 0 : -1} aria-hidden={expanded ? undefined : true}>
							{data.label}
							<span>· {data.effort}</span>
						</button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content className="composer-model-menu" align="end" sideOffset={6} collisionPadding={8}>
							<DropdownMenu.Sub>
								<DropdownMenu.SubTrigger className="composer-model-menu-item">Models</DropdownMenu.SubTrigger>
								<DropdownMenu.Portal>
									<DropdownMenu.SubContent className="composer-model-menu" sideOffset={4} collisionPadding={8}>
										{data.groups.map((group) => (
											<DropdownMenu.Group key={group.provider}>
												<DropdownMenu.Label className="composer-model-menu-label">{group.provider}</DropdownMenu.Label>
												{group.models.map((model) => (
													<DropdownMenu.Item key={model.id} className="composer-model-menu-item" onSelect={() => void choose({ provider: group.provider, modelId: model.id })}>
														<span>{model.name}</span>
														{group.provider === data.selected?.provider && model.id === data.selected.modelId ? <span className="composer-model-check">✓</span> : null}
													</DropdownMenu.Item>
												))}
											</DropdownMenu.Group>
										))}
									</DropdownMenu.SubContent>
								</DropdownMenu.Portal>
							</DropdownMenu.Sub>
							{data.efforts.length > 0 ? (
								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger className="composer-model-menu-item">Effort</DropdownMenu.SubTrigger>
									<DropdownMenu.Portal>
										<DropdownMenu.SubContent className="composer-model-menu" sideOffset={4} collisionPadding={8}>
											{data.efforts.map((level) => (
												<DropdownMenu.Item key={level} className="composer-model-menu-item" onSelect={() => void choose({ level })}>
													<span>{level}</span>
													{level === data.effort ? <span className="composer-model-check">✓</span> : null}
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
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{props.open ? <path d="m9 18 6-6-6-6" /> : <path d="m15 18-6-6 6-6" />}
		</svg>
	);
}
