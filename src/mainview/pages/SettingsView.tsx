/**
 * SettingsView — the settings dialog content (direction A structure + C print-orange palette).
 * Grouped list: GENERAL (partner_profile_path) + RUNTIME (model / api key status).
 * Settings persist in ~/.config/.partner.
 */
import { createSignal } from "solid-js";
import { Button } from "../components/Button";
import { TextField, TextFieldInput, TextFieldLabel } from "../components/ui/text-field";

export interface SettingsData {
	partner_profile_path: string;
}

export interface RuntimeInfo {
	model: string;
	apiKeyConfigured: boolean;
}

export function SettingsView(props: { settings: SettingsData | null; runtime: RuntimeInfo | null; onSave: (settings: SettingsData) => Promise<void>; onLoad: () => void }) {
	const [path, setPath] = createSignal("");
	const [saved, setSaved] = createSignal(false);

	if (props.settings && path() === "" && props.settings.partner_profile_path !== path()) {
		setPath(props.settings.partner_profile_path);
	}
	if (!props.settings) props.onLoad();

	const save = async () => {
		await props.onSave({ partner_profile_path: path().trim() || "~/.partner/" });
		setSaved(true);
		setTimeout(() => setSaved(false), 1500);
	};

	return (
		<div class="flex flex-col">
			{/* GENERAL */}
			<div class="flex flex-col gap-2 pb-4">
				<span class="font-sans text-[10px] uppercase tracking-[0.2em] text-[#757575]">General</span>
				<TextField>
					<TextFieldLabel class="text-[#757575]">partner_profile_path</TextFieldLabel>
					<TextFieldInput
						class="bg-white border-print-line focus-visible:border-print"
						value={path()}
						onInput={(e) => setPath(e.currentTarget.value)}
						placeholder="~/.partner/"
						spellcheck={false}
					/>
				</TextField>
				<span class="text-[12px] text-[#757575]">Directory where partner profiles are saved when created.</span>
			</div>

			{/* RUNTIME */}
			<div class="border-t border-print-line py-4 flex flex-col gap-2">
				<span class="font-sans text-[10px] uppercase tracking-[0.2em] text-[#757575]">Runtime</span>
				<div class="flex items-baseline justify-between font-sans text-[13px] text-[#111110]">
					<span class="text-[#757575]">model</span>
					<span class="font-mono text-[12px]">{props.runtime?.model ?? "—"}</span>
				</div>
				<div class="flex items-baseline justify-between font-sans text-[13px] text-[#111110]">
					<span class="text-[#757575]">api key</span>
					<span>{props.runtime ? (props.runtime.apiKeyConfigured ? "configured" : "missing") : "—"}</span>
				</div>
			</div>

			{/* Save */}
			<div class="border-t border-print-line pt-4 flex items-center justify-end gap-2">
				{saved() && <span class="text-[12px] text-[#757575]">Saved ✓</span>}
				<Button class="bg-print text-white hover:bg-print/90" onClick={save}>
					Save
				</Button>
			</div>
		</div>
	);
}
