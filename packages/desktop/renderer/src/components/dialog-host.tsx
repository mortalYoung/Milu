import type { Host } from "@milu/window";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { createElement, useState } from "react";
import { useStore } from "zustand";

export function DialogHost(props: { host: Host }) {
	const { host } = props;
	const pending = useStore(host.dialogs.store, (state) => state.pending);
	const [last, setLast] = useState(pending);
	if (pending !== null && pending !== last) setLast(pending);
	const shown = pending ?? last;

	const custom = shown?.dialog.kind === "custom" ? host.dialogs.get(shown.dialog.id) : undefined;
	const palette = shown?.dialog.kind === "custom" && shown.dialog.presentation === "palette";
	const dismissOnOutsideClick = shown?.dialog.kind !== "custom" || shown.dialog.dismissOnOutsideClick !== false;

	return (
		<Dialog.Root open={pending !== null} modal={!palette} onOpenChange={(open) => (open ? undefined : host.dialogs.resolve(null))}>
			<Dialog.Portal>
				{palette ? null : <Dialog.Overlay className="conv-dialog-overlay" />}
				<Dialog.Content
					className={palette ? "palette-anchor" : `conv-dialog${custom ? " wide" : ""}`}
					aria-describedby={undefined}
					onPointerDownOutside={(event) => {
						if (!dismissOnOutsideClick) event.preventDefault();
					}}
				>
					{pending?.dialog.kind === "confirm" ? (
						<>
							<Dialog.Title className="conv-dialog-title">{pending.dialog.copy.title}</Dialog.Title>
							{pending.dialog.copy.description ? <Dialog.Description className="conv-dialog-description">{pending.dialog.copy.description}</Dialog.Description> : null}
							<div className="conv-dialog-actions">
								<button type="button" className="conv-dialog-button" onClick={() => host.dialogs.resolve(false)}>
									Cancel
								</button>
								<button type="button" className={`conv-dialog-button${pending.dialog.copy.danger ? " danger" : ""}`} onClick={() => host.dialogs.resolve(true)}>
									{pending.dialog.copy.confirmLabel ?? "OK"}
								</button>
							</div>
						</>
					) : custom ? (
						<>
							<Dialog.Title className="conv-dialog-hidden">{pending?.dialog.kind === "custom" ? (pending.dialog.title ?? pending.dialog.id) : ""}</Dialog.Title>
							{palette ? null : (
								<Dialog.Close className="conv-dialog-close" aria-label="Close">
									<X size={16} />
								</Dialog.Close>
							)}
							{createElement(custom, {
								host,
								data: shown?.dialog.kind === "custom" ? shown.dialog.data : undefined,
								close: (value: unknown) => host.dialogs.resolve(value),
							})}
						</>
					) : (
						<Dialog.Title className="conv-dialog-title">No such dialog: {shown?.dialog.kind === "custom" ? shown.dialog.id : ""}</Dialog.Title>
					)}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
