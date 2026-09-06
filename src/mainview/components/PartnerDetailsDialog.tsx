/**
 * PartnerDetailsDialog — read a partner like a letter (direction C: salutation / body / P.S.).
 * A blank section stays visibly blank — writing nothing is a valid choice, shown as such.
 */
import { createResource, For, Show } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { ActivityHeatmap, HEATMAP_WEEKS } from "./ActivityHeatmap";
import type { PartnerItem } from "./ConversationList";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function postmarkDate(ts: number): string {
	const d = new Date(ts);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function PartnerDetailsDialog(props: { partner: PartnerItem | null; onOpenChange: (open: boolean) => void }) {
	const p = () => props.partner;

	const [days] = createResource(
		() => (p() ? p()!.name : null),
		async (name) => (await rpc.request.partner_activity({ name, weeks: HEATMAP_WEEKS })).days,
	);
	const [skills] = createResource(
		() => (p() ? p()!.name : null),
		async (name) => (await rpc.request.skill_list({ partner: name })).skills,
	);

	return (
		<Dialog open={p() != null} onOpenChange={props.onOpenChange}>
			{/* The dialog is the desk; the sheet is the letter itself, filling it edge to edge */}
			<DialogContent class="w-[540px] max-w-[540px] bg-paper p-0 gap-0">
				{/* a11y title (visually, the letter is the title) */}
				<DialogTitle class="sr-only">{p()?.name ?? ""}</DialogTitle>
				{p() && (
					// pt-12 keeps the salutation clear of the dialog's close button; pr-20 clears the postmark stamp
					<div class="letter-sheet pt-12">
						<span class="letter-postmark">
							<span>{postmarkDate(p()!.createdAt)}</span>
							<span>letters</span>
						</span>
						<p class="letter-sal pr-20">
							Dear <span class="letter-alias-static">{p()!.name}</span>,
						</p>

						{/* Body: the persona, read on the ruled lines */}
						{p()!.persona?.trim() ? (
							<div class="letter-lines">
								<div class="md letter-read" innerHTML={renderMarkdown(p()!.persona!)} />
							</div>
						) : (
							<p class="letter-lines letter-blank">persona not written</p>
						)}

						<Show when={days()}>
							<div class="letter-pps">
								<span class="letter-ps-label leading-[10px]">P.P.S.</span>
								<ActivityHeatmap days={days()!} />
							</div>
						</Show>

						<Show when={skills() && skills()!.length > 0}>
							<div class="letter-pps">
								<span class="letter-ps-label leading-[10px]">P.P.P.S.</span>
								<ul class="mt-1 flex flex-col gap-1">
									<For each={skills()}>
										{(s) => (
											<li class="font-mono text-[11px] text-ink-soft">
												{s.name} <span class="text-muted">· {s.scope}</span>
											</li>
										)}
									</For>
								</ul>
							</div>
						</Show>

						{/* Sign-off, like the conversation letters */}
						<p class="letter-sign">— {p()!.name}</p>
					</div>
				)}
				{/* No footer button: the letter is closed via Esc / the X button */}
			</DialogContent>
		</Dialog>
	);
}
