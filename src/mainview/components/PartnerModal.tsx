import { useRef } from "react";
import { imeGuard } from "../lib/ime";
import { type PartnerFormData, usePartnerForm } from "../lib/partner-form";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { PickFile } from "./PickFile";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Kbd, KbdGroup } from "./ui/kbd";
import { TextField, TextFieldInput, TextFieldLabel, TextFieldTextArea } from "./ui/text-field";

export interface PartnerModalProps {
	open: boolean;
	existingNames: string[];
	onOpenChange: (open: boolean) => void;
	onConfirm: (data: PartnerFormData) => Promise<string | null>;
}

export function PartnerModal(props: PartnerModalProps) {
	const form = usePartnerForm({ open: props.open, existingNames: props.existingNames, onConfirm: props.onConfirm });
	const nameIme = useRef<ReturnType<typeof imeGuard> | null>(null);
	const personaIme = useRef<ReturnType<typeof imeGuard> | null>(null);
	if (!nameIme.current) nameIme.current = imeGuard(form.setName);
	if (!personaIme.current) personaIme.current = imeGuard(form.setPersona);

	const typedName = form.name.trim();
	const nameError = form.error?.field === "name" ? form.error.message : null;
	const formError = form.error && form.error.field === null ? form.error.message : null;

	const holdClose = (event: Event) => {
		if (form.dirty || form.saving) event.preventDefault();
	};

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="w-[600px] max-w-[min(600px,calc(100vw-32px))] gap-0 overflow-hidden bg-surface p-0" onEscapeKeyDown={holdClose} onInteractOutside={holdClose}>
				<DialogHeader className="sr-only">
					<DialogTitle>Create</DialogTitle>
					<DialogDescription>Create a new partner in the configured directory.</DialogDescription>
				</DialogHeader>

				<form
					className="flex flex-col"
					autoComplete="off"
					onSubmit={(event) => {
						event.preventDefault();
						void form.submit();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							void form.submit();
						}
					}}
				>
					<header className="border-b border-line px-5 py-4">
						<h2 className="font-sans text-[17px] font-semibold tracking-tight text-ink">Create</h2>
						<p className="mt-1 font-sans text-[12px] text-muted">Only the name is required.</p>
					</header>

					<div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3.5 px-5 py-4">
						<aside className="border-r border-line pr-3.5">
							<span className="grid size-[44px] place-items-center rounded-full bg-hover font-serif text-[18px] font-semibold leading-none text-ink">
								{typedName ? typedName[0]!.toUpperCase() : "?"}
							</span>
							<p className={cn("mt-2 truncate font-sans text-[14px] font-medium", typedName ? "text-ink" : "text-muted-soft")}>{typedName || "Untitled"}</p>
						</aside>

						<div className="grid min-w-0 content-start gap-3">
							<TextField>
								<TextFieldLabel htmlFor="partner-name">
									Name
									<span className="ml-1.5 font-mono text-[10px] font-normal tracking-normal normal-case text-muted-soft">required</span>
								</TextFieldLabel>
								<TextFieldInput
									id="partner-name"
									value={form.name}
									onChange={(event) => form.setName(event.currentTarget.value)}
									onCompositionStart={nameIme.current.onStart}
									onCompositionEnd={(event) => nameIme.current!.onEnd(event.nativeEvent, event.currentTarget)}
									onKeyDown={(event) => nameIme.current!.onKeyDown(event.nativeEvent)}
									placeholder="ada"
									aria-invalid={Boolean(nameError)}
									aria-describedby={nameError ? "partner-name-error" : undefined}
									className={cn(nameError && "border-signal")}
									autoFocus
								/>
								{nameError && (
									<p id="partner-name-error" role="alert" className="font-sans text-[12px] text-signal">
										{nameError}
									</p>
								)}
							</TextField>

							<TextField>
								<TextFieldLabel htmlFor="partner-persona">Persona</TextFieldLabel>
								<TextFieldTextArea
									id="partner-persona"
									rows={3}
									className="min-h-0 resize-none"
									value={form.persona}
									onChange={(event) => form.setPersona(event.currentTarget.value)}
									onCompositionStart={personaIme.current.onStart}
									onCompositionEnd={(event) => personaIme.current!.onEnd(event.nativeEvent, event.currentTarget)}
									placeholder={"## Persona\n\nHow should this partner work and speak? Markdown supported…"}
									spellCheck={false}
								/>
							</TextField>

							<TextField>
								<TextFieldLabel>Workspace</TextFieldLabel>
								<PickFile
									value={form.workspace}
									variant="default"
									placeholder="Choose a directory…"
									title="Workspace directory"
									ariaLabel="Workspace directory"
									onPick={form.setWorkspace}
								/>
							</TextField>
						</div>
					</div>

					<DialogFooter className="flex-row items-center gap-2 border-t border-line px-5 py-3.5 sm:space-x-0">
						<KbdGroup>
							<Kbd>⌘</Kbd>
							<Kbd>↵</Kbd>
						</KbdGroup>
						{formError ? (
							<p role="alert" className="min-w-0 flex-1 font-sans text-[12px] leading-snug text-signal">
								{formError}
							</p>
						) : (
							<span className="flex-1" />
						)}
						<Button type="button" variant="ghost" size="sm" disabled={form.saving} onClick={() => props.onOpenChange(false)}>
							{form.dirty ? "Discard" : "Cancel"}
						</Button>
						<Button type="submit" variant="primary" size="sm" disabled={form.saving}>
							{form.saving ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
