import { activityAt, convTime, previewFor } from "../lib/chat-preview";
import { fileGlyph } from "../lib/file-icons";
import { type PaletteRow, splitPath } from "../lib/palette";
import { Avatar } from "./ui/avatar";
import { Tip } from "./ui/tooltip";

export function PaletteList(props: { rows: PaletteRow[]; index: number; unread: (name: string) => boolean; onPick: (row: PaletteRow) => void; onHover: (index: number) => void }) {
	const isSelected = (index: number) => index === props.index;
	const rowClass = (index: number) => "palette-row" + (isSelected(index) ? " selected" : "");

	return (
		<div className="palette-list" role="listbox" id="palette-list" aria-label="Results">
			{props.rows.map((row, index) => {
				if (row.kind === "header") {
					return (
						<div className="palette-group" role="presentation" key={`h:${row.label}`}>
							{row.label}
						</div>
					);
				}
				if (row.kind === "session") {
					return (
						<button
							type="button"
							key={`s:${row.partner.name}`}
							id={`palette-option-${index}`}
							className={rowClass(index)}
							role="option"
							aria-selected={isSelected(index)}
							onMouseEnter={() => props.onHover(index)}
							onClick={() => props.onPick(row)}
						>
							<Avatar name={row.partner.name} size="sm" variant="surface" />
							<span className="palette-row-main">
								<span className="palette-row-title">{row.partner.name}</span>
								<span className="palette-row-sub">{previewFor(row.partner) || "—"}</span>
							</span>
							{row.partner.workspace && <span className="palette-row-dir">{splitPath(row.partner.workspace).name}</span>}
							{props.unread(row.partner.name) && (
								<Tip label="new messages">
									<span className="conv-unread-dot" />
								</Tip>
							)}
							<span className="palette-row-time">{convTime(activityAt(row.partner))}</span>
						</button>
					);
				}
				if (row.kind === "file") {
					const parts = splitPath(row.file.path);
					return (
						<button
							type="button"
							key={`f:${row.file.path}`}
							id={`palette-option-${index}`}
							className={rowClass(index)}
							role="option"
							aria-selected={isSelected(index)}
							onMouseEnter={() => props.onHover(index)}
							onClick={() => props.onPick(row)}
						>
							{fileGlyph(row.file.name, "palette-row-icon")}
							<span className="palette-row-title palette-row-file">{parts.name}</span>
							<span className="palette-row-dir">{parts.dir}</span>
						</button>
					);
				}
				if (row.kind === "grant") {
					const on = row.grant.granted || row.grant.alwaysOn;
					const body = (
						<>
							<span className={on ? "palette-row-glyph on" : "palette-row-glyph"} aria-hidden="true">
								{on ? "✓" : "·"}
							</span>
							<span className={on ? "palette-row-grant on" : "palette-row-grant"}>{row.grant.name}</span>
							{row.grant.detail && <span className="palette-row-sub min-w-0 flex-1">{row.grant.detail}</span>}
							{row.grant.meta && <span className="palette-row-meta">{row.grant.meta}</span>}
						</>
					);
					if (row.grant.alwaysOn) {
						return (
							<div className="palette-row static" role="presentation" key={`g:${row.grant.group}:${row.grant.name}`}>
								{body}
							</div>
						);
					}
					return (
						<button
							type="button"
							key={`g:${row.grant.group}:${row.grant.name}`}
							id={`palette-option-${index}`}
							className={rowClass(index)}
							role="option"
							aria-selected={isSelected(index)}
							onMouseEnter={() => props.onHover(index)}
							onClick={() => props.onPick(row)}
						>
							{body}
						</button>
					);
				}
				return null;
			})}
		</div>
	);
}
