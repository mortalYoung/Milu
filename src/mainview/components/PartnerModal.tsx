import { createPartnerForm, type PartnerFormData } from "../lib/partner-form";
import { Button } from "./Button";
import { PickFile } from "./PickFile";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export interface PartnerModalProps {
	open: boolean;
	existingNames: string[];
	onOpenChange: (open: boolean) => void;
	onConfirm: (data: PartnerFormData) => Promise<string | null>;
}

export function PartnerModal(props: PartnerModalProps) {
	const form = createPartnerForm({
		open: () => props.open,
		existingNames: () => props.existingNames,
		onConfirm: props.onConfirm,
	});

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent class="w-[540px] max-w-[540px] bg-paper p-0 gap-0">
				<DialogHeader class="sr-only">
					<DialogTitle>Add Partner</DialogTitle>
					<DialogDescription>Create a new partner profile in the configured directory.</DialogDescription>
				</DialogHeader>

				<form class="letter-sheet" onSubmit={form.submit} autocomplete="off">
					<span class="letter-eyebrow">new letter</span>
					<p class="letter-sal">
						Dear
						<input class="letter-alias" value={form.name()} onInput={(e) => form.setName(e.currentTarget.value)} placeholder="alias" aria-label="Partner name" autofocus />,
					</p>
					{form.error() && (
						<p class="letter-error" role="alert">
							{form.error()}
						</p>
					)}

					{/* Body: written straight onto the ruled lines */}
					<textarea
						class="letter-lines-input"
						rows={6}
						value={form.responsibilities()}
						onInput={(e) => form.setResponsibilities(e.currentTarget.value)}
						placeholder={"## Responsibilities\n\nMarkdown supported…"}
						spellcheck={false}
						aria-label="Persona"
					/>

					{/* P.S.: the tone of the reply, further down the sheet */}
					<p class="letter-ps-label letter-ps-spacer">P.S.</p>
					<textarea
						class="letter-lines-input"
						rows={3}
						value={form.tones()}
						onInput={(e) => form.setTones(e.currentTarget.value)}
						placeholder={"## Tones\n\nMarkdown supported…"}
						spellcheck={false}
						aria-label="Tones"
					/>
					<p class="letter-note">Format rules (inline-code file references) are fixed by the system — only the tone is written here.</p>

					<div class="mt-4 flex flex-col gap-1.5">
						<span class="letter-ps-label">
							Workspace <span class="text-muted">(optional)</span>
						</span>
						<PickFile value={form.workspace()} placeholder="Choose a project directory…" title="Workspace directory" ariaLabel="Workspace directory" onPick={form.setWorkspace} />
						<p class="letter-note">Leave empty to default file operations to this partner's storage. Clear later with /workspace.</p>
					</div>

					<DialogFooter class="letter-footer">
						<Button type="submit" disabled={form.saving()} class="bg-seal text-on-ink hover:bg-seal/90">
							{form.saving() ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
