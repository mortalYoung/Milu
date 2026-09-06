import { createEffect, createSignal, type JSX } from "solid-js";

export interface PartnerFormData {
	name: string;
	responsibilities?: string;
	tones?: string;
	workspace?: string;
}

export function createPartnerForm(opts: { open: () => boolean; existingNames: () => string[]; onConfirm: (data: PartnerFormData) => Promise<string | null> }) {
	const [name, setName] = createSignal("");
	const [responsibilities, setResponsibilities] = createSignal("");
	const [tones, setTones] = createSignal("");
	const [workspace, setWorkspace] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);

	// Fresh dialog on every open: the modal stays mounted between opens (the Dialog only hides it),
	// so the form state would otherwise leak into the next session. Getters keep the reads reactive.
	createEffect(() => {
		if (opts.open()) {
			setName("");
			setResponsibilities("");
			setTones("");
			setWorkspace("");
			setError(null);
		}
	});

	const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (e) => {
		e.preventDefault();
		if (!name().trim()) {
			setError("Enter a name to continue");
			return;
		}
		if (opts.existingNames().some((n) => n.toLowerCase() === name().trim().toLowerCase())) {
			setError(`Partner "${name().trim()}" already exists`);
			return;
		}
		setSaving(true);
		setError(null);
		const err = await opts.onConfirm({
			name: name().trim(),
			responsibilities: responsibilities().trim() || undefined,
			tones: tones().trim() || undefined,
			workspace: workspace().trim() || undefined,
		});
		setSaving(false);
		if (err) setError(err);
	};

	return { name, setName, responsibilities, setResponsibilities, tones, setTones, workspace, setWorkspace, error, saving, submit };
}
