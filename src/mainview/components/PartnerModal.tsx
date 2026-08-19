/**
 * PartnerModal — Add Partner, written as a letter (direction C: salutation / body / P.S.).
 * "Dear <alias>," is the only required line; the alias is just a handle for the user to tell
 * partners apart. The body and P.S. are written directly on the ruled lines of the sheet —
 * leaving them blank is a valid letter, no toggles needed.
 */
import { createEffect, createSignal, type JSX } from "solid-js";
import { Button } from "./Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export interface PartnerFormData {
	name: string;
	responsibilities?: string;
	tones?: string;
}

export function PartnerModal(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (data: PartnerFormData) => Promise<string | null>;
	/** Existing partner names — the name becomes a folder, so duplicates are rejected (case-insensitive, like the filesystem). */
	existingNames: string[];
}) {
	const [name, setName] = createSignal("");
	const [responsibilities, setResponsibilities] = createSignal("");
	const [tones, setTones] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);

	const formData = (): PartnerFormData => ({
		name: name().trim(),
		responsibilities: responsibilities().trim() || undefined,
		tones: tones().trim() || undefined,
	});

	// Fresh dialog on every open: the modal stays mounted between opens (the Dialog only hides it),
	// so the form state would otherwise leak into the next session.
	createEffect(() => {
		if (props.open) {
			setName("");
			setResponsibilities("");
			setTones("");
			setError(null);
		}
	});

	const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (e) => {
		e.preventDefault();
		if (!name().trim()) {
			setError("Enter a name to continue");
			return;
		}
		if (props.existingNames.some((n) => n.toLowerCase() === name().trim().toLowerCase())) {
			setError(`Partner "${name().trim()}" already exists`);
			return;
		}
		setSaving(true);
		setError(null);
		const err = await props.onConfirm(formData());
		setSaving(false);
		if (err) setError(err);
	};

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			{/* The dialog is the desk; the sheet is the letter itself, filling it edge to edge */}
			<DialogContent class="w-[540px] max-w-[540px] bg-paper p-0 gap-0">
				<DialogHeader class="sr-only">
					<DialogTitle>Add Partner</DialogTitle>
					<DialogDescription>Create a new partner profile in the configured directory.</DialogDescription>
				</DialogHeader>

				<form class="letter-sheet" onSubmit={submit} autocomplete="off">
					{/* A new letter begins with its header, then the salutation — the alias is literally the opening line */}
					<span class="letter-eyebrow">new letter</span>
					<p class="letter-sal">
						Dear
						<input class="letter-alias" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="alias" aria-label="Partner name" autofocus />,
					</p>
					{error() && (
						<p class="letter-error" role="alert">
							{error()}
						</p>
					)}

					{/* Body: written straight onto the ruled lines */}
					<textarea
						class="letter-lines-input"
						rows={6}
						value={responsibilities()}
						onInput={(e) => setResponsibilities(e.currentTarget.value)}
						placeholder={"## Responsibilities\n\nMarkdown supported…"}
						spellcheck={false}
						aria-label="Persona"
					/>

					{/* P.S.: the tone of the reply, further down the sheet */}
					<p class="letter-ps-label letter-ps-spacer">P.S.</p>
					<textarea
						class="letter-lines-input"
						rows={3}
						value={tones()}
						onInput={(e) => setTones(e.currentTarget.value)}
						placeholder={"## Tones\n\nMarkdown supported…"}
						spellcheck={false}
						aria-label="Tones"
					/>
					<p class="letter-note">Format rules (inline-code file references) are fixed by the system — only the tone is written here.</p>

					<DialogFooter class="letter-footer">
						{/* No Cancel: the dialog closes via Esc / the X button — a letter is either sent or torn up */}
						<Button type="submit" disabled={saving()} class="bg-seal text-on-ink hover:bg-seal/90">
							{saving() ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
