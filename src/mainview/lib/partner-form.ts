import { useEffect, useRef, useState } from "react";

export interface PartnerFormData {
	name: string;
	persona?: string;
	workspace?: string;
}

export interface PartnerFormError {
	field: "name" | null;
	message: string;
}

export function usePartnerForm(opts: { open: boolean; existingNames: string[]; onConfirm: (data: PartnerFormData) => Promise<string | null> }) {
	const [name, setName] = useState("");
	const [persona, setPersona] = useState("");
	const [workspace, setWorkspace] = useState("");
	const [error, setError] = useState<PartnerFormError | null>(null);
	const [saving, setSaving] = useState(false);
	const busy = useRef(false);

	useEffect(() => {
		if (!opts.open) return;
		setName("");
		setPersona("");
		setWorkspace("");
		setError(null);
		setSaving(false);
		busy.current = false;
	}, [opts.open]);

	const updateName = (value: string) => {
		setName(value);
		setError((current) => (current?.field === "name" ? null : current));
	};

	const submit = async () => {
		if (busy.current) return;
		const trimmed = name.trim();
		if (!trimmed) {
			setError({ field: "name", message: "Name is required" });
			return;
		}
		if (opts.existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
			setError({ field: "name", message: `"${trimmed}" already exists · choose a different name` });
			return;
		}

		busy.current = true;
		setSaving(true);
		setError(null);
		const message = await opts.onConfirm({
			name: trimmed,
			persona: persona.trim() || undefined,
			workspace: workspace.trim() || undefined,
		});
		busy.current = false;
		setSaving(false);
		if (message) setError({ field: null, message });
	};

	return {
		name,
		setName: updateName,
		persona,
		setPersona,
		workspace,
		setWorkspace,
		error,
		saving,
		dirty: Boolean(name.trim() || persona.trim() || workspace.trim()),
		submit,
	};
}
