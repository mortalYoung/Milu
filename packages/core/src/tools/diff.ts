import { createTwoFilesPatch, diffLines, FILE_HEADERS_ONLY } from "diff";

export interface DiffSummary {
	readonly diff: string;
	readonly firstChangedLine: number | undefined;
}

export function generateUnifiedPatch(path: string, oldContent: string, newContent: string, contextLines = 4): string {
	return createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, { context: contextLines, headerOptions: FILE_HEADERS_ONLY });
}

export function generateDiffString(oldContent: string, newContent: string, contextLines = 4): DiffSummary {
	const parts = diffLines(oldContent, newContent);
	const output: string[] = [];
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const lineNumWidth = String(Math.max(oldLines.length, newLines.length)).length;
	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();
		if (part.added || part.removed) {
			if (firstChangedLine === undefined) firstChangedLine = newLineNum;
			for (const line of raw) {
				if (part.added) {
					output.push(`+${String(newLineNum).padStart(lineNumWidth, " ")} ${line}`);
					newLineNum++;
				} else {
					output.push(`-${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
			continue;
		}
		const nextPartIsChange = index < parts.length - 1 && Boolean(parts[index + 1].added || parts[index + 1].removed);
		const hasLeadingChange = lastWasChange;
		const hasTrailingChange = nextPartIsChange;
		if (hasLeadingChange && hasTrailingChange) {
			if (raw.length <= contextLines * 2) {
				for (const line of raw) {
					output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			} else {
				const leadingLines = raw.slice(0, contextLines);
				const trailingLines = raw.slice(raw.length - contextLines);
				const skippedLines = raw.length - leadingLines.length - trailingLines.length;
				for (const line of leadingLines) {
					output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
				for (const line of trailingLines) {
					output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			}
		} else if (hasLeadingChange) {
			const shownLines = raw.slice(0, contextLines);
			const skippedLines = raw.length - shownLines.length;
			for (const line of shownLines) {
				output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
				oldLineNum++;
				newLineNum++;
			}
			if (skippedLines > 0) {
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
			}
		} else if (hasTrailingChange) {
			const skippedLines = Math.max(0, raw.length - contextLines);
			if (skippedLines > 0) {
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
			}
			for (const line of raw.slice(skippedLines)) {
				output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
				oldLineNum++;
				newLineNum++;
			}
		} else {
			oldLineNum += raw.length;
			newLineNum += raw.length;
		}
		lastWasChange = false;
	}
	return { diff: output.join("\n"), firstChangedLine };
}
