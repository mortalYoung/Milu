/**
 * PartnerModal — 添加 Partner(入职)弹窗,主从导航版(方向 D)。
 * 左栏:name/avatar 常显 + PERSONA/RESPONSE-FORMAT 字段按钮(状态点 + 行数);
 * 右栏:当前字段的 markdown 编辑器,Edit/Preview 切换。
 * 可编辑字段只有 role(必填)/ Responsibilities / Tones;IDENTIFY 与 TOOL-GUIDANCE
 * 由系统生成,Preview 展示四段拼装后的完整系统提示词。
 */
import { createSignal, type JSX } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import { Button } from "./Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export interface PartnerFormData {
	name: string;
	avatar?: string;
	/** 角色短语(如 "Front-End Programmer"),必填。 */
	role: string;
	responsibilities?: string;
	tones?: string;
}

type FieldId = "persona" | "response-format";

const FIELDS: { id: FieldId; label: string }[] = [
	{ id: "persona", label: "Persona" },
	{ id: "response-format", label: "Response Format" },
];

/** 左栏小标签 */
const MINI_LABEL = "font-sans text-[9px] uppercase tracking-[0.18em] text-[#9a9a94]";
/** 字段名标签 */
const FIELD_LABEL = "font-sans text-[11px] uppercase tracking-[0.2em] text-[#111110]";
/** 编辑器类(等宽,印刷橙聚焦);markdown 大段文案场景,纵向尽量吃满 */
const EDITOR_CLS =
	"w-full min-h-[300px] resize-none border border-print-line rounded-[6px] bg-white px-3 py-2.5 font-mono text-[13px] leading-[1.7] text-[#111110] placeholder:text-[#b0a89a] outline-none focus-visible:border-print";
/** 短输入类(role) */
const INPUT_CLS =
	"h-8 rounded-[6px] border border-print-line bg-white px-2 font-mono text-[12px] text-[#111110] placeholder:text-[#b0a89a] outline-none focus-visible:border-print";

export function PartnerModal(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (data: PartnerFormData) => Promise<string | null>;
	/** 试拼四段系统提示词(Preview 展示最终拼装效果)。 */
	onPreview: (data: PartnerFormData) => Promise<string>;
}) {
	const [name, setName] = createSignal("");
	const [avatar, setAvatar] = createSignal("");
	const [role, setRole] = createSignal("");
	const [responsibilities, setResponsibilities] = createSignal("");
	const [tones, setTones] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);
	// 主从状态:当前字段 + 编辑/预览
	const [active, setActive] = createSignal<FieldId>("persona");
	const [tab, setTab] = createSignal<"edit" | "preview">("edit");
	// 预览 = 拼装后的完整系统提示词(懒加载 + 内容变更后失效)
	const [preview, setPreview] = createSignal<string | null>(null);
	const [previewLoading, setPreviewLoading] = createSignal(false);

	/** 头像预览:输入 emoji/单字符时直接显示;否则回落为名字首字母(不加载外部图) */
	const avatarPreview = () => {
		const a = avatar().trim();
		const n = name().trim();
		if (a && a.length <= 4 && !/\./.test(a)) return a;
		return n ? n.charAt(0) : "?";
	};

	const formData = (): PartnerFormData => ({
		name: name().trim(),
		avatar: avatar().trim() || undefined,
		role: role().trim(),
		responsibilities: responsibilities().trim() || undefined,
		tones: tones().trim() || undefined,
	});

	/** 字段值(编辑内容);RESPONSE-FORMAT = 单一 tones */
	const valueOf = (f: FieldId): string => (f === "persona" ? responsibilities() : tones());
	const setValueOf = (f: FieldId, v: string) => {
		if (f === "persona") setResponsibilities(v);
		else setTones(v);
	};
	/** 字段填充状态(persona 含 role 或 responsibilities) */
	const filledOf = (f: FieldId): boolean => (f === "persona" ? role().trim() !== "" || responsibilities().trim() !== "" : tones().trim() !== "");
	const linesOf = (f: FieldId): number => valueOf(f).split("\n").length;

	/** 拉取拼装预览(每次进入 Preview 都重新拼,反映最新编辑) */
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
		if (!role().trim()) {
			setError("Enter a role to continue — e.g. Front-End Programmer");
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
						{/* ————— 左栏:name/avatar 常显 + 字段导航 ————— */}
						<div class="border-r border-print-line p-3 flex flex-col gap-1.5">
							<span class={MINI_LABEL}>name</span>
							<input class={INPUT_CLS} value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="bob" autofocus />
							<div class="flex items-end gap-1.5">
								<div class="flex flex-col gap-1 flex-1 min-w-0">
									<span class={MINI_LABEL}>avatar</span>
									<input class={INPUT_CLS + " min-w-0"} value={avatar()} onInput={(e) => setAvatar(e.currentTarget.value)} placeholder="emoji" spellcheck={false} />
								</div>
								{/* 实时头像预览 */}
								<span
									class="size-[26px] rounded-full bg-[#111110] text-white flex items-center justify-center font-mono text-[11px] leading-none shrink-0 mb-0.5"
									title="Avatar preview"
									aria-hidden="true"
								>
									{avatarPreview()}
								</span>
							</div>
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

						{/* ————— 右栏:当前字段编辑器 / 拼装预览 ————— */}
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
										{active() === "persona" && (
											<>
												{/* role 必填:短词输入,persona 页常显 */}
												<div class="flex flex-col gap-1">
													<span class={MINI_LABEL}>role *</span>
													<input class={INPUT_CLS} value={role()} onInput={(e) => setRole(e.currentTarget.value)} placeholder="Front-End Programmer" spellcheck={false} />
												</div>
												<span class={MINI_LABEL}>responsibilities</span>
											</>
										)}
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
