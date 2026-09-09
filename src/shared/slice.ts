import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { projectSliceItems, type SliceItem } from "./entry-meta";
import { projectOrigin } from "./origin";

export interface FoldSliceOptions {
	keepDangling?: boolean;
}

export function foldSliceItems(entries: Entry[], options: FoldSliceOptions = {}): SliceItem[] {
	return projectSliceItems(projectOrigin(entries), options);
}

export function foldSlice(entries: Entry[], options: FoldSliceOptions = {}): AgentMessage[] {
	return foldSliceItems(entries, options).map((item) => item.message);
}
