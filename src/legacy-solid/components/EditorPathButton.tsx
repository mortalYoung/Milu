import { ExternalLink } from "lucide-solid";
import { For, Show } from "solid-js";
import { formatWorkspacePath } from "../lib/composer-input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";

export function EditorPathButton(props: {
	path: string;
	editors?: { id: string; name: string }[];
	onOpenPath?: (path: string, editorId?: string) => void;
	label?: string;
	max?: number;
	class?: string;
}) {
	const title = () => `${props.path} — open folder in code editor`;
	return (
		<ContextMenu>
			<ContextMenuTrigger as="button" type="button" class={"path-open min-w-0 " + (props.class ?? "")} title={title()} onClick={() => props.onOpenPath?.(props.path)}>
				<Show when={props.label}>
					<span class="path-label">{props.label}</span>{" "}
				</Show>
				<span class="truncate">{formatWorkspacePath(props.path, props.max ?? 36)}</span>
				<ExternalLink size={10} class="path-external" />
			</ContextMenuTrigger>
			<ContextMenuContent size="sm" portal={false}>
				<For each={props.editors ?? []}>
					{(editor) => (
						<ContextMenuItem size="sm" onSelect={() => props.onOpenPath?.(props.path, editor.id)}>
							Open in {editor.name}
						</ContextMenuItem>
					)}
				</For>
				<ContextMenuItem size="sm" onSelect={() => props.onOpenPath?.(props.path)}>
					Open with default
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
