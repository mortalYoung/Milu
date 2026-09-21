import { type FormEvent, useEffect, useState } from "react";

export interface PartnerFormData {
	name: string;
	persona?: string;
	workspace?: string;
}

export function usePartnerForm(opts: { open: boolean; existingNames: string[]; onConfirm: (data: PartnerFormData) => Promise<string | null> }) {
	const [name, setName] = useState("");
	const [persona, setPersona] = useState("");
	const [workspace, setWorkspace] = useState("");
	const [caveman, setCaveman] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!opts.open) return;
		setName("");
		setPersona("");
		setWorkspace("");
		setCaveman(true);
		setError(null);
	}, [opts.open]);

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!name.trim()) {
			setError("Enter a name to continue");
			return;
		}
		if (opts.existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase())) {
			setError(`Partner "${name.trim()}" already exists`);
			return;
		}
		setSaving(true);
		setError(null);
		const message = await opts.onConfirm({
			name: name.trim(),
			persona: persona.trim() || undefined,
			workspace: workspace.trim() || undefined,
		});
		setSaving(false);
		if (message) setError(message);
	};

	return { name, setName, persona, setPersona, workspace, setWorkspace, caveman, setCaveman, error, saving, submit };
}
