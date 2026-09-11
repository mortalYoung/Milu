import { For, Show } from "solid-js";
import { convTime, previewFor } from "../lib/chat-preview";
import { fileGlyph } from "../lib/file-icons";
import { type PaletteRow, splitPath } from "../lib/palette";
import { Avatar } from "./ui/avatar";

export function PaletteList(props: { rows: PaletteRow[]; index: number; unread: (name: string) => boolean; onPick: (row: PaletteRow) => void; onHover: (index: number) => void }) {
	const isSelected = (index: number) => index === props.index;
	const rowClass = (index: number) => "palette-row" + (isSelected(index) ? " selected" : "");

	return (
		<div class="palette-list" role="listbox" id="palette-list" aria-label="Results">
			<For each={props.rows}>
				{(row, index) => {
					if (row.kind === "header")
						return (
							<div class="palette-group" role="presentation">
								{row.label}
							</div>
						);
					if (row.kind === "session") {
						return (
							<button
								type="button"
								id={`palette-option-${index()}`}
								class={rowClass(index())}
								role="option"
								aria-selected={isSelected(index())}
								onMouseEnter={() => props.onHover(index())}
								onClick={() => props.onPick(row)}
							>
								<Avatar name={row.partner.name} size="sm" variant="paper" />
								<span class="palette-row-main">
									<span class="palette-row-title">{row.partner.name}</span>
									<span class="palette-row-sub">{previewFor(row.partner) || "—"}</span>
								</span>
								<Show when={props.unread(row.partner.name)}>
									<span class="conv-unread-dot" title="new messages" />
								</Show>
								<span class="palette-row-time">{convTime(row.partner.lastMessageAt ?? row.partner.createdAt)}</span>
							</button>
						);
					}
					if (row.kind === "file") {
						const parts = splitPath(row.file.path);
						return (
							<button
								type="button"
								id={`palette-option-${index()}`}
								class={rowClass(index())}
								role="option"
								aria-selected={isSelected(index())}
								onMouseEnter={() => props.onHover(index())}
								onClick={() => props.onPick(row)}
							>
								{fileGlyph(row.file.name, "palette-row-icon")}
								<span class="palette-row-title palette-row-file">{parts.name}</span>
								<span class="palette-row-dir">{parts.dir}</span>
							</button>
						);
					}
					if (row.kind === "grant") {
						const on = row.grant.granted || row.grant.alwaysOn;
						const body = (
							<>
								<span class={on ? "palette-row-glyph on" : "palette-row-glyph"} aria-hidden="true">
									{on ? "✓" : "·"}
								</span>
								<span class={on ? "palette-row-grant on" : "palette-row-grant"}>{row.grant.name}</span>
								<Show when={row.grant.detail}>
									<span class="palette-row-sub min-w-0 flex-1">{row.grant.detail}</span>
								</Show>
								<Show when={row.grant.meta}>
									<span class="palette-row-meta">{row.grant.meta}</span>
								</Show>
							</>
						);
						if (row.grant.alwaysOn)
							return (
								<div class="palette-row static" role="presentation">
									{body}
								</div>
							);
						return (
							<button
								type="button"
								id={`palette-option-${index()}`}
								class={rowClass(index())}
								role="option"
								aria-selected={isSelected(index())}
								onMouseEnter={() => props.onHover(index())}
								onClick={() => props.onPick(row)}
							>
								{body}
							</button>
						);
					}
				}}
			</For>
		</div>
	);
}
