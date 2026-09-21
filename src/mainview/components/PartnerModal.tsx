import { useRef } from "react";
import { imeGuard } from "../lib/ime";
import { type PartnerFormData, usePartnerForm } from "../lib/partner-form";
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
	return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

export function PartnerModal(props: PartnerModalProps) {
	const form = usePartnerForm({ open: props.open, existingNames: props.existingNames, onConfirm: props.onConfirm });
	const nameIme = useRef<ReturnType<typeof imeGuard> | null>(null);
	const personaIme = useRef<ReturnType<typeof imeGuard> | null>(null);
	if (!nameIme.current) nameIme.current = imeGuard(form.setName);
	if (!personaIme.current) personaIme.current = imeGuard(form.setPersona);

	const previewName = form.name.trim() || "New partner";

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="w-[700px] max-w-[700px] bg-letter p-0 gap-0 overflow-hidden">
				<DialogHeader className="sr-only">
					<DialogTitle>Add Partner</DialogTitle>
					<DialogDescription>Create a new partner profile in the configured directory.</DialogDescription>
				</DialogHeader>

				<form className="flex flex-col" onSubmit={form.submit} autoComplete="off">
					<div className="px-6 pt-5 pb-4 border-b border-hairline">
						<span className="eyebrow">Letters · New partner</span>
						<h2 className="mt-1 font-sans text-[20px] font-bold text-ink tracking-tight">Create partner</h2>
					</div>

					<div className="grid grid-cols-[200px_1fr] gap-6 px-6 pt-5 pb-2">
						<aside className="pr-5 border-r border-hairline">
							<div className="size-[76px] rounded-full bg-ink text-paper flex items-center justify-center font-serif text-[32px] font-semibold">{avatarInitial(form.name)}</div>
							<h3 className="mt-3 font-serif text-[17px] font-semibold text-ink truncate">{previewName}</h3>
							<p className="font-sans text-[10px] uppercase tracking-[0.1em] text-muted">new correspondent</p>
							<p className="mt-4 font-sans text-[11.5px] leading-[1.6] text-body-muted">
								Folder: partners/{form.name.trim() || "…"}
								<br />
								Created just now
							</p>
							<div className="mt-5 size-[58px] rounded-full border border-dashed border-seal text-seal flex items-center justify-center font-sans text-[8.5px] uppercase tracking-[0.1em] -rotate-12">
								letters
							</div>
						</aside>

						<div className="grid gap-3 min-w-0 content-start">
							{form.error && (
								<p className="font-sans text-[12px] text-seal" role="alert">
									{form.error}
								</p>
							)}

							<div className="grid grid-cols-2 gap-3">
								<div className="grid gap-1">
									<label htmlFor="partner-name" className="font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] text-body-muted">
										Name <span className="text-seal">*</span>
									</label>
									<input
										id="partner-name"
										className="h-[32px] w-full rounded-[7px] border border-hairline bg-letter px-2.5 font-sans text-[12.5px] text-ink placeholder:text-muted focus:border-seal focus:outline-none focus:ring-2 focus:ring-seal/20"
										value={form.name}
										onChange={(event) => form.setName(event.currentTarget.value)}
										onCompositionStart={nameIme.current.onStart}
										onCompositionEnd={(event) => nameIme.current!.onEnd(event.nativeEvent, event.currentTarget)}
										onKeyDown={(event) => nameIme.current!.onKeyDown(event.nativeEvent)}
										placeholder="e.g. ada"
										autoFocus
									/>
								</div>
								<div className="grid gap-1">
									<label className="font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] text-body-muted">
										Workspace <span className="normal-case text-muted">(optional)</span>
									</label>
									<PickFile
										value={form.workspace}
										variant="compact"
										class="font-sans"
										placeholder="Choose a directory…"
										title="Workspace directory"
										ariaLabel="Workspace directory"
										onPick={form.setWorkspace}
									/>
								</div>
							</div>

							<div className="grid gap-1">
								<label htmlFor="partner-persona" className="font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] text-body-muted">
									Persona
								</label>
								<textarea
									id="partner-persona"
									rows={4}
									className="w-full resize-none rounded-[7px] border border-hairline bg-letter px-2.5 py-2 font-sans text-[12.5px] leading-[1.5] text-ink placeholder:text-muted focus:border-seal focus:outline-none focus:ring-2 focus:ring-seal/20"
									value={form.persona}
									onChange={(event) => form.setPersona(event.currentTarget.value)}
									onCompositionStart={personaIme.current.onStart}
									onCompositionEnd={(event) => personaIme.current!.onEnd(event.nativeEvent, event.currentTarget)}
									placeholder={"## Persona\n\nHow should this partner work and speak? Markdown supported…"}
									spellCheck={false}
								/>
								<p className="font-sans text-[10.5px] text-muted">Markdown supported. Format rules are fixed by the system.</p>
							</div>

							<div className="flex items-center justify-between pt-1">
								<span className="font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] text-body-muted">Caveman</span>
								<Switch checked={form.caveman} onChange={form.setCaveman} aria-label="Caveman" />
							</div>
						</div>
					</div>

					<DialogFooter className="px-6 pt-4 pb-5 mt-4 border-t border-hairline">
						<Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={form.saving} class="bg-seal text-on-ink hover:bg-seal/90">
							{form.saving ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
