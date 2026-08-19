/**
 * PartnerDetailsDialog — read a partner like a letter (direction C: salutation / body / P.S.).
 * A blank section stays visibly blank — writing nothing is a valid choice, shown as such.
 */
import { renderMarkdown } from "../lib/markdown";
import type { PartnerItem } from "./ConversationList";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function postmarkDate(ts: number): string {
	const d = new Date(ts);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function PartnerDetailsDialog(props: { partner: PartnerItem | null; onOpenChange: (open: boolean) => void }) {
	const p = () => props.partner;

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

						{/* Body: persona, read on the ruled lines */}
						{p()!.responsibilities?.trim() ? (
							<div class="letter-lines">
								<div class="md letter-read" innerHTML={renderMarkdown(p()!.responsibilities!)} />
							</div>
						) : (
							<p class="letter-lines letter-blank">persona not written</p>
						)}

						{/* P.S.: tones, further down the sheet */}
						<span class="letter-ps-label letter-ps-spacer">P.S.</span>
						{p()!.tones?.trim() ? (
							<div class="letter-lines">
								<div class="md letter-read" innerHTML={renderMarkdown(p()!.tones!)} />
							</div>
						) : (
							<p class="letter-lines letter-blank">no P.S.</p>
						)}

						{/* Sign-off, like the conversation letters */}
						<p class="letter-sign">— {p()!.name}</p>
					</div>
				)}
				{/* No footer button: the letter is closed via Esc / the X button */}
			</DialogContent>
		</Dialog>
	);
}
