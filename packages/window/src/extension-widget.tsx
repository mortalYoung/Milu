import type { ComponentType } from "react";

import type { ExtensionWidgetProps } from "./api/widget.ts";
import { ExtensionSurface } from "./extension-surface.tsx";
import type { SlotProps } from "./slots.ts";

export function ExtensionWidget(props: SlotProps & { readonly extension: string; readonly widget: string; readonly component: ComponentType<ExtensionWidgetProps> }) {
	const { host, data, extension, widget, component } = props;

	return <ExtensionSurface host={host} extension={extension} id={widget} data={data} component={component} />;
}
