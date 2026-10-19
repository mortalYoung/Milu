import type { ConfirmCopy } from "@milu/protocol";
import * as Dialog from "@radix-ui/react-dialog";

export function ConfirmDialog(props: { copy: ConfirmCopy | null; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
	return (
		<Dialog.Root open={props.copy !== null} onOpenChange={(open) => (open ? undefined : props.onCancel())}>
			<Dialog.Portal>
				<Dialog.Overlay className="conv-dialog-overlay" />
				<Dialog.Content className="conv-dialog">
					<Dialog.Title className="conv-dialog-title">{props.copy?.title ?? ""}</Dialog.Title>
					{props.copy?.description ? <Dialog.Description className="conv-dialog-description">{props.copy.description}</Dialog.Description> : null}
					<div className="conv-dialog-actions">
						<button type="button" className="conv-dialog-button" onClick={props.onCancel}>
							Cancel
						</button>
						<button type="button" className={`conv-dialog-button${props.danger ? " danger" : ""}`} onClick={props.onConfirm}>
							{props.copy?.confirmLabel ?? "OK"}
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
