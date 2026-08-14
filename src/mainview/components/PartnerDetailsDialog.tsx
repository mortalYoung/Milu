/**
 * PartnerDetailsDialog — 查看 Partner 档案弹窗(主从导航版,方向 D)。
 * 左栏:档案头(头像/名字/role)+ PERSONA/RESPONSE-FORMAT 字段按钮(状态点 + 行数);
 * 右栏:当前字段的 markdown 渲染视图;右上 created 邮戳徽章。
 */
import { createSignal, For } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import { Button } from "./Button";
import type { PartnerItem } from "./ConversationList";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./ui/dialog";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function postmarkDate(ts: number): string {
	const d = new Date(ts);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

type FieldId = "persona" | "response-format";
const FIELDS: { id: FieldId; label: string }[] = [
	{ id: "persona", label: "Persona" },
	{ id: "response-format", label: "Response Format" },
];
const FIELD_LABEL = "font-sans text-[11px] uppercase tracking-[0.2em] text-[#111110]";

export function PartnerDetailsDialog(props: { partner: PartnerItem | null; onOpenChange: (open: boolean) => void }) {
	const p = () => props.partner;
	// 当前查看字段
	const [active, setActive] = createSignal<FieldId>("persona");

	/** 字段值;PERSONA = responsibilities(role 展示在角色行) */
	const valueOf = (f: FieldId, partner: PartnerItem): string => (f === "persona" ? (partner.responsibilities ?? "") : (partner.tones ?? ""));
	const filledOf = (f: FieldId, partner: PartnerItem): boolean => valueOf(f, partner).trim() !== "";
	const linesOf = (f: FieldId, partner: PartnerItem): number => valueOf(f, partner).split("\n").length;

	return (
		<Dialog open={p() != null} onOpenChange={props.onOpenChange}>
			<DialogContent class="w-[960px] max-w-[960px] bg-white border-print-line">
				{/* a11y 标题(视觉上档案头即标题) */}
				<DialogTitle class="sr-only">{p()?.name ?? ""}</DialogTitle>
				{p() && (
					<div class="grid grid-cols-[150px_1fr]">
						{/* ————— 左栏:档案头 + 字段导航 ————— */}
						<div class="border-r border-print-line p-3 flex flex-col gap-1.5">
							<div class="flex items-center gap-2.5 pb-2 min-w-0">
								<span class="conv-avatar bg-[#111110] text-white border-0">
									{p()!.avatar ? <span class="text-[15px]">{p()!.avatar}</span> : <span class="avatar-initial">{p()!.name.charAt(0)}</span>}
								</span>
								<div class="flex flex-col min-w-0">
									<span class="font-serif text-[15px] font-semibold text-[#111110] leading-tight truncate">{p()!.name}</span>
									<span class="font-sans text-[10px] text-[#757575] truncate mt-0.5">{p()!.role ?? "partner"}</span>
								</div>
							</div>

							<div class="h-px bg-print-line mb-1" />

							<For each={FIELDS}>
								{(f) => {
									const filled = filledOf(f.id, p()!);
									return (
										<button type="button" class={"field-btn" + (active() === f.id ? " active" : "")} onClick={() => setActive(f.id)}>
											<span class="flex items-center gap-1.5 min-w-0">
												<span class={filled ? "field-dot-filled" : "field-dot-empty"} />
												<span class={FIELD_LABEL}>{f.label}</span>
											</span>
											<span class="font-mono text-[10px] text-[#9a9a94]">{filled ? `${linesOf(f.id, p()!)} lines` : "empty"}</span>
										</button>
									);
								}}
							</For>
						</div>

						{/* ————— 右栏:渲染视图 + created 徽章 ————— */}
						<div class="flex flex-col min-w-0">
							<div class="flex items-center justify-between px-4 pt-3 pb-2 gap-2">
								<span class={FIELD_LABEL}>{FIELDS.find((f) => f.id === active())?.label}</span>
								<span class="font-sans text-[8.5px] uppercase tracking-[0.12em] text-print border border-dashed border-print rounded-[4px] px-2 py-1 whitespace-nowrap shrink-0">
									Created · {postmarkDate(p()!.createdAt)}
								</span>
							</div>
							{/* role 只读展示(persona 页档案头下方角色行) */}
							{active() === "persona" && p()!.role && (
								<div class="px-4 pb-2 font-mono text-[12px] text-[#111110]">
									<span class="text-[#9a9a94]">Role: </span>
									{p()!.role}
								</div>
							)}
							<div class="px-4 pb-4 min-h-0">
								{valueOf(active(), p()!).trim() ? (
									<div
										class="md min-h-[300px] max-h-[480px] overflow-y-auto border border-print-line rounded-[6px] bg-white px-4 py-3"
										innerHTML={renderMarkdown(valueOf(active(), p()!))}
									/>
								) : (
									<div class="min-h-[300px] flex items-center justify-center border border-print-line rounded-[6px] bg-white">
										<span class="font-sans text-[12px] text-[#9a9a94]">— empty —</span>
									</div>
								)}
							</div>
						</div>
					</div>
				)}
				<DialogFooter class="border-t border-print-line pt-4">
					<Button variant="outline" class="border-[#111110]/40 bg-white text-[#111110] hover:bg-print-tint" onClick={() => props.onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
