import { imeGuard } from "../lib/ime";
import { createPartnerForm, type PartnerFormData } from "../lib/partner-form";
import { Button } from "./Button";
import { PickFile } from "./PickFile";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Switch } from "./ui/switch";

export interface PartnerModalProps {
	open: boolean;
	existingNames: string[];
	onOpenChange: (open: boolean) => void;
	onConfirm: (data: PartnerFormData) => Promise<string | null>;
}

function avatarInitial(name: string): string {
	const trimmed = name.trim();
	return trimmed ? trimmed[0].toUpperCase() : "?";
}

export function PartnerModal(props: PartnerModalProps) {
	const form = createPartnerForm({
		open: () => props.open,
		existingNames: () => props.existingNames,
		onConfirm: props.onConfirm,
	});

	const previewName = () => form.name().trim() || "New partner";
	const nameIme = imeGuard(form.setName);
	const personaIme = imeGuard(form.setPersona);

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent class="w-[700px] max-w-[700px] bg-letter p-0 gap-0 overflow-hidden">
				<DialogHeader class="sr-only">
					<DialogTitle>Add Partner</DialogTitle>
					<DialogDescription>Create a new partner profile in the configured directory.</DialogDescription>
				</DialogHeader>

				<form class="flex flex-col" onSubmit={form.submit} autocomplete="off">
					<div class="px-6 pt-5 pb-4 border-b border-hairline">
						<span class="eyebrow">Letters · New partner</span>
						<h2 class="mt-1 font-sans text-[20px] font-bold text-ink tracking-tight">Create partner</h2>
					</div>

					<div class="grid grid-cols-[200px_1fr] gap-6 px-6 pt-5 pb-2">
						<aside class="pr-5 border-r border-hairline">
							<div class="size-[76px] rounded-full bg-ink text-paper flex items-center justify-center font-serif text-[32px] font-semibold">{avatarInitial(form.name())}</div>
							<h3 class="mt-3 font-serif text-[17px] font-semibold text-ink truncate">{previewName()}</h3>
							<p class="font-sans text-[10px] uppercase tracking-[0.1em] text-muted">new correspondent</p>
							<p class="mt-4 font-sans text-[11.5px] leading-[1.6] text-body-muted">
								Folder: partners/{form.name().trim() || "…"}
								<br />
								Created just now
							</p>
							<div class="mt-5 size-[58px] rounded-full border border-dashed border-seal text-seal flex items-center justify-center font-sans text-[8.5px] uppercase tracking-[0.1em] -rotate-12">
								letters
							</div>
						</aside>

						<div class="grid gap-3 min-w-0 content-start">
							{form.error() && (
								<p class="font-sans text-[12px] text-seal" role="alert">
									{form.error()}
								</p>
							)}

							<div class="grid grid-cols-2 gap-3">
								<div class="grid gap-1">
									<label for="partner-name" class="font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] text-body-muted">
										Name <span class="text-seal">*</span>
									</label>
									<input
										id="partner-name"
										class="h-[32px] w-full rounded-[7px] border border-hairline bg-letter px-2.5 font-sans text-[12.5px] text-ink placeholder:text-muted focus:border-seal focus:outline-none focus:ring-2 focus:ring-seal/20"
										value={form.name()}
										onInput={(e) => form.setName(e.currentTarget.value)}
										onCompositionStart={nameIme.onStart}
										onCompositionEnd={(e) => nameIme.onEnd(e, e.currentTarget)}
										onKeyDown={nameIme.onKeyDown}
										placeholder="e.g. ada"
										autofocus
									/>
								</div>
								<div class="grid gap-1">
									<label class="font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] text-body-muted">
										Workspace <span class="normal-case text-muted">(optional)</span>
									</label>
									<PickFile
										value={form.workspace()}
										variant="compact"
										class="font-sans"
										placeholder="Choose a directory…"
										title="Workspace directory"
										ariaLabel="Workspace directory"
										onPick={form.setWorkspace}
									/>
								</div>
							</div>

							<div class="grid gap-1">
								<label for="partner-persona" class="font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] text-body-muted">
									Persona
								</label>
								<textarea
									id="partner-persona"
									rows={4}
									class="w-full resize-none rounded-[7px] border border-hairline bg-letter px-2.5 py-2 font-sans text-[12.5px] leading-[1.5] text-ink placeholder:text-muted focus:border-seal focus:outline-none focus:ring-2 focus:ring-seal/20"
									value={form.persona()}
									onInput={(e) => form.setPersona(e.currentTarget.value)}
									onCompositionStart={personaIme.onStart}
									onCompositionEnd={(e) => personaIme.onEnd(e, e.currentTarget)}
									placeholder="## Persona&#10;&#10;How should this partner work and speak? Markdown supported…"
									spellcheck={false}
								/>
								<p class="font-sans text-[10.5px] text-muted">Markdown supported. Format rules are fixed by the system.</p>
							</div>

							<div class="flex items-center justify-between pt-1">
								<span class="font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] text-body-muted">Caveman</span>
								<Switch checked={form.caveman()} onChange={form.setCaveman} aria-label="Caveman" />
							</div>
						</div>
					</div>

					<DialogFooter class="px-6 pt-4 pb-5 mt-4 border-t border-hairline">
						<Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={form.saving()} class="bg-seal text-on-ink hover:bg-seal/90">
							{form.saving() ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
