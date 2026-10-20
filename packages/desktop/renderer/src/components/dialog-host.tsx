import type { Host } from "@milu/extensions/host";
import * as Dialog from "@radix-ui/react-dialog";
import { createElement } from "react";
import { useStore } from "zustand";

export function DialogHost(props: { host: Host }) {
	const { host } = props;
	const pending = useStore(host.dialogs.store, (state) => state.pending);

	const custom = pending?.dialog.kind === "custom" ? host.dialogs.get(pending.dialog.id) : undefined;

	return (
		<Dialog.Root open={pending !== null} onOpenChange={(open) => (open ? undefined : host.dialogs.resolve(null))}>
			<Dialog.Portal>
				<Dialog.Overlay className="conv-dialog-overlay" />
				<Dialog.Content className={`conv-dialog${custom ? " wide" : ""}`} aria-describedby={undefined}>
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
							{createElement(custom, {
								host,
								data: pending?.dialog.kind === "custom" ? pending.dialog.data : undefined,
								close: (value: unknown) => host.dialogs.resolve(value),
							})}
						</>
					) : (
						<Dialog.Title className="conv-dialog-title">No such dialog: {pending?.dialog.kind === "custom" ? pending.dialog.id : ""}</Dialog.Title>
					)}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
