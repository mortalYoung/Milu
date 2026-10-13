import { ExternalLink } from "lucide-react";
import { formatWorkspacePath } from "../lib/composer-input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";
import { Tip } from "./ui/tooltip";

export function EditorPathButton(props: {
	path: string;
	editors?: { id: string; name: string }[];
	onOpenPath?: (path: string, editorId?: string) => void;
	label?: string;
	max?: number;
	class?: string;
}) {
	const title = `${props.path} — open folder in code editor`;
	return (
		<ContextMenu>
			<Tip label={title}>
				<ContextMenuTrigger asChild>
					<button type="button" className={"path-open min-w-0 " + (props.class ?? "")} onClick={() => props.onOpenPath?.(props.path)}>
						{props.label ? (
							<>
								<span className="path-label">{props.label}</span>{" "}
							</>
						) : null}
						<span className="truncate">{formatWorkspacePath(props.path, props.max ?? 36)}</span>
						<ExternalLink size={10} className="path-external" />
					</button>
				</ContextMenuTrigger>
			</Tip>
			<ContextMenuContent size="sm" portal={false}>
				{(props.editors ?? []).map((editor) => (
					<ContextMenuItem key={editor.id} size="sm" onSelect={() => props.onOpenPath?.(props.path, editor.id)}>
						Open in {editor.name}
					</ContextMenuItem>
				))}
				<ContextMenuItem size="sm" onSelect={() => props.onOpenPath?.(props.path)}>
					Open with default
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
