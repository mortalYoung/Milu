import { Component, type ComponentType, type ReactNode, useMemo } from "react";

import { type ExtensionWidgetProps, type WidgetContextValue, WidgetContext } from "./api/widget.ts";
import type { SlotProps } from "./slots.ts";

interface BoundaryState {
	readonly error: string | null;
}

export class WidgetBoundary extends Component<{ readonly id: string; readonly children: ReactNode }, BoundaryState> {
	override state: BoundaryState = { error: null };

	static getDerivedStateFromError(error: unknown): BoundaryState {
		return { error: error instanceof Error ? error.message : String(error) };
	}

	override render(): ReactNode {
		if (this.state.error !== null) {
			return (
				<div role="alert" className="rounded-md border border-line px-3 py-2 font-mono text-[11px] text-muted">
					{this.props.id} failed: {this.state.error}
				</div>
			);
		}
		return this.props.children;
	}
}

export function ExtensionWidget(props: SlotProps & { readonly extension: string; readonly widget: string; readonly component: ComponentType<ExtensionWidgetProps> }) {
	const { host, data, extension, widget, component: Widget } = props;

	const value = useMemo<WidgetContextValue>(
		() => ({
			extension,
			id: widget,
			data,
			getSession: () => {
				const selected = host.selection.store.getState().selected;
				return selected === "" ? null : selected;
			},
			watchSession: (listener) => host.selection.store.subscribe(listener),
			load: async (key, session) => {
				const { data: value } = await host.connection.request("extensionData", { extension, key, session });
				return value;
			},
			execute: async (command, ...args) => {
				const selected = host.selection.store.getState().selected;
				return host.actions.invoke(command, selected === "" ? undefined : selected, args.length === 0 ? undefined : args.length === 1 ? args[0] : args);
			},
		}),
		[host, extension, widget, data],
	);

	return (
		<WidgetBoundary id={extension}>
			<WidgetContext.Provider value={value}>
				<Widget id={widget} data={data} />
			</WidgetContext.Provider>
		</WidgetBoundary>
	);
}
