import { Component, type ComponentType, type ReactNode, useMemo } from "react";

import { activityOf, type ExtensionWidgetProps, type WidgetContextValue, WidgetContext } from "./api/widget.ts";
import type { Host } from "./surfaces.ts";

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

function surfaceContext(host: Host, extension: string, id: string, data: unknown): WidgetContextValue {
	return {
		extension,
		id,
		data,
		getSession: () => {
			const selected = host.selection.store.getState().selected;
			return selected === "" ? null : selected;
		},
		watchSession: (listener) => host.selection.store.subscribe(listener),
		activity: (session) => activityOf(host, session),
		watchActivity: (listener) => {
			const offs = [host.sessions.store.subscribe(listener), host.connection.store.subscribe(listener)];
			return () => {
				for (const off of offs) off();
			};
		},
		motion: () => host.motion.get(id),
		watchMotion: (listener) => host.motion.store.subscribe(listener),
		watchSettings: (listener) => {
			const subscription = host.connection.onLive((event) => {
				if (event.type === "settings") listener();
			});
			return () => subscription.dispose();
		},
		load: async (key, session) => {
			const { data: value } = await host.connection.request("extensionData", { extension, key, session });
			return value;
		},
		execute: async (command, ...args) => {
			const selected = host.selection.store.getState().selected;
			return host.actions.invoke(command, selected === "" ? undefined : selected, args.length === 0 ? undefined : args.length === 1 ? args[0] : args);
		},
	};
}

export function ExtensionSurface(props: {
	readonly host: Host;
	readonly extension: string;
	readonly id: string;
	readonly data: unknown;
	readonly component: ComponentType<ExtensionWidgetProps>;
}) {
	const { host, extension, id, data, component: Component } = props;
	const value = useMemo(() => surfaceContext(host, extension, id, data), [host, extension, id, data]);

	return (
		<WidgetBoundary id={extension}>
			<WidgetContext.Provider value={value}>
				<Component id={id} data={data} />
			</WidgetContext.Provider>
		</WidgetBoundary>
	);
}
