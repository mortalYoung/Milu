/**
 * PartnerModal — the Add Partner (onboarding) dialog, master-detail navigation variant (direction D).
 * Left column: name always visible + PERSONA/RESPONSE-FORMAT field buttons (status dot + line count);
 * right column: markdown editor for the current field, with an Edit/Preview toggle.
 * The only editable fields are Responsibilities / Tones; IDENTIFY and TOOL-GUIDANCE
 * are system-generated, and Preview shows the complete four-section system prompt.
 */
import { createEffect, createSignal, type JSX } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import { Button } from "./Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export interface PartnerFormData {
	name: string;
	responsibilities?: string;
	tones?: string;
}

type FieldId = "persona" | "response-format";

const FIELDS: { id: FieldId; label: string }[] = [
	{ id: "persona", label: "Persona" },
	{ id: "response-format", label: "Response Format" },
];

/** Left-column mini label */
const MINI_LABEL = "font-sans text-[9px] uppercase tracking-[0.18em] text-[#9a9a94]";
/** Field name label */
const FIELD_LABEL = "font-sans text-[11px] uppercase tracking-[0.2em] text-[#111110]";
/** Editor class (monospace, print-orange focus); for large markdown text areas, fill vertically as much as possible */
const EDITOR_CLS =
	"w-full min-h-[300px] resize-none border border-print-line rounded-[6px] bg-white px-3 py-2.5 font-mono text-[13px] leading-[1.7] text-[#111110] placeholder:text-[#b0a89a] outline-none focus-visible:border-print";
/** Short input class (name) */
const INPUT_CLS =
	"h-8 rounded-[6px] border border-print-line bg-white px-2 font-mono text-[12px] text-[#111110] placeholder:text-[#b0a89a] outline-none focus-visible:border-print";

export function PartnerModal(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (data: PartnerFormData) => Promise<string | null>;
	/** Compose a trial four-section system prompt (Preview shows the final assembled result). */
	onPreview: (data: PartnerFormData) => Promise<string>;
	/** Existing partner names — the name becomes a folder, so duplicates are rejected (case-insensitive, like the filesystem). */
	existingNames: string[];
}) {
	const [name, setName] = createSignal("");
	const [responsibilities, setResponsibilities] = createSignal("");
	const [tones, setTones] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);
	const [active, setActive] = createSignal<FieldId>("persona");
	const [tab, setTab] = createSignal<"edit" | "preview">("edit");
	// Preview = the assembled complete system prompt (lazy-loaded + invalidated when content changes)
	const [preview, setPreview] = createSignal<string | null>(null);
	const [previewLoading, setPreviewLoading] = createSignal(false);

	const formData = (): PartnerFormData => ({
		name: name().trim(),
		responsibilities: responsibilities().trim() || undefined,
		tones: tones().trim() || undefined,
	});

	/** Field value (edited content); RESPONSE-FORMAT = the single tones value */
	const valueOf = (f: FieldId): string => (f === "persona" ? responsibilities() : tones());
	const setValueOf = (f: FieldId, v: string) => {
		if (f === "persona") setResponsibilities(v);
		else setTones(v);
	};
	/** Field fill state */
	const filledOf = (f: FieldId): boolean => (f === "persona" ? responsibilities().trim() !== "" : tones().trim() !== "");
	// Fresh dialog on every open: the modal stays mounted between opens (the Dialog only hides it),
	// so the form state would otherwise leak into the next session.
	createEffect(() => {
		if (props.open) {
			setName("");
			setResponsibilities("");
			setTones("");
			setError(null);
			setActive("persona");
			setTab("edit");
			setPreview(null);
		}
	});
	const linesOf = (f: FieldId): number => valueOf(f).split("\n").length;

	/** Fetch the assembled preview (re-assembled on every entry into Preview, reflecting the latest edits) */
	function loadPreview() {
		setPreviewLoading(true);
		props
			.onPreview(formData())
			.then(setPreview)
			.finally(() => setPreviewLoading(false));
	}

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
			<DialogContent class="w-[1080px] max-w-[1080px] bg-white border-print-line">
				<DialogHeader>
					<DialogTitle>Add Partner</DialogTitle>
					<DialogDescription>Create a new partner profile in the configured directory.</DialogDescription>
				</DialogHeader>

				<form class="flex flex-col" onSubmit={submit}>
					<div class="grid grid-cols-[150px_1fr]">
						{/* ————— Left column: name always visible + field navigation ————— */}
						<div class="border-r border-print-line p-3 flex flex-col gap-1.5">
							<span class={MINI_LABEL}>name</span>
							<input class={INPUT_CLS} value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="bob" autofocus />
							<div class="my-1 h-px bg-print-line" />

							{FIELDS.map((f) => {
								const filled = filledOf(f.id);
								return (
									<button
										type="button"
										class={"field-btn" + (active() === f.id ? " active" : "")}
										onClick={() => {
											setActive(f.id);
											setTab("edit");
										}}
									>
										<span class="flex items-center gap-1.5 min-w-0">
											<span class={filled ? "field-dot-filled" : "field-dot-empty"} />
											<span class={FIELD_LABEL}>{f.label}</span>
										</span>
										<span class="font-mono text-[10px] text-[#9a9a94]">{filled ? `${linesOf(f.id)} lines` : "empty"}</span>
									</button>
								);
							})}
						</div>

						{/* ————— Right column: current field editor / assembled preview ————— */}
						<div class="flex flex-col min-w-0">
							<div class="flex items-center justify-between px-4 pt-3 pb-2">
								<span class={FIELD_LABEL}>{FIELDS.find((f) => f.id === active())?.label}</span>
								<div class="flex items-center gap-1.5">
									<button type="button" class={"tab-pill" + (tab() === "edit" ? " active" : "")} onClick={() => setTab("edit")}>
										Edit
									</button>
									<button
										type="button"
										class={"tab-pill" + (tab() === "preview" ? " active" : "")}
										onClick={() => {
											setTab("preview");
											loadPreview();
										}}
									>
										Preview
									</button>
								</div>
							</div>
							<div class="px-4 pb-4 min-h-0">
								{tab() === "edit" ? (
									<div class="flex flex-col gap-2">
										{active() === "persona" && <span class={MINI_LABEL}>responsibilities</span>}
										{active() === "response-format" && <span class={MINI_LABEL}>tones</span>}
										<textarea
											class={EDITOR_CLS}
											rows={14}
											value={valueOf(active())}
											onInput={(e) => setValueOf(active(), e.currentTarget.value)}
											placeholder={active() === "persona" ? "## Responsibilities\n\nMarkdown supported…" : "## Tones\n\nMarkdown supported…"}
											spellcheck={false}
										/>
										{active() === "response-format" && (
											<span class="font-sans text-[10.5px] leading-relaxed text-[#9a9a94]">
												The remaining format rules (file references as Markdown inline code) are fixed and generated by the system; they show up in Preview.
											</span>
										)}
									</div>
								) : (
									<div class="md min-h-[340px] max-h-[480px] overflow-y-auto border border-print-line rounded-[6px] bg-white px-4 py-3">
										{previewLoading() ? (
											<span class="font-sans text-[12px] text-[#9a9a94]">Composing…</span>
										) : preview() ? (
											<span innerHTML={renderMarkdown(preview()!)} />
										) : (
											<span class="font-sans text-[12px] text-[#9a9a94]">— empty —</span>
										)}
									</div>
								)}
							</div>
						</div>
					</div>

					{error() && <div class="text-[13px] text-error pt-2">{error()}</div>}

					<DialogFooter class="border-t border-print-line pt-4">
						<Button variant="ghost" class="text-[#111110] hover:bg-print-tint" onClick={() => props.onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving()} class="bg-print text-white hover:bg-print/90">
							{saving() ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
