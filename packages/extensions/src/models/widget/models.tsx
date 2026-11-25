import { composerDataKey } from "@milu/protocol";
import { useComposerData, type WidgetProps } from "@milu/window/api";
import { Tip } from "@milu/window/api/tooltip";
import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";

import type { ModelWidgetData } from "../index.ts";
import { MODEL_PANEL, ModelPanel, ModelPill, modelRowsOf, type ModelRow } from "../picker.tsx";

function ModelsPlaceholder(props: { readonly error: boolean }) {
	const label = props.error ? "Model unavailable" : "Loading model";
	return (
		<Tip label={label}>
			<span className="grid h-[26px] w-[26px] shrink-0 place-items-center" aria-busy={props.error ? undefined : true} aria-label={label}>
				<span className={`size-[14px] rounded-full border-2 ${props.error ? "border-dashed border-line" : "animate-pulse border-line motion-reduce:animate-none"}`} />
			</span>
		</Tip>
	);
}

export function ModelsWidget(props: WidgetProps) {
	const { data, status } = useComposerData<ModelWidgetData | null>(props.host, composerDataKey("composer.right", "models"));
	const [open, setOpen] = useState(false);

	if (!data) {
		if (status === "ready") return null;
		return <ModelsPlaceholder error={status === "error"} />;
	}

	const { host } = props;
	const rows = modelRowsOf(data.groups);

	const choose = async (args: unknown): Promise<void> => {
		const session = host.selection.store.getState().selected;
		await host.actions.invoke(args && typeof args === "object" && "level" in args ? "model.effort" : "model.set", session, args);
		await host.sessions.refresh();
		await host.composerData.refresh(session);
	};

	const pick = (row: ModelRow): void => {
		setOpen(false);
		void choose({ provider: row.provider, modelId: row.id });
	};

	const resolved = data.resolved;
	const current = resolved === null ? "pick a model" : data.label;

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild>
				<ModelPill
					provider={resolved?.provider ?? null}
					label={current}
					effort={data.effort}
					aria-label={resolved === null ? "Pick a model" : `Model ${data.label}, effort ${data.effort}`}
					title={resolved === null ? "Pick a model" : `${data.label}${data.effort === "" ? "" : ` · ${data.effort}`}`}
				/>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="top"
					align="end"
					sideOffset={8}
					collisionPadding={8}
					className={MODEL_PANEL}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
					}}
				>
					<ModelPanel rows={rows} selected={resolved} onPick={pick} efforts={data.efforts} effort={data.effort} onEffort={(level) => void choose({ level })} />
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

export default ModelsWidget;
