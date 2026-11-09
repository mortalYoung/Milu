export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export interface Truncation {
	readonly content: string;
	readonly truncated: boolean;
	readonly truncatedBy: "lines" | "bytes" | null;
	readonly totalLines: number;
	readonly totalBytes: number;
	readonly outputLines: number;
	readonly outputBytes: number;
	readonly lastLinePartial: boolean;
	readonly firstLineExceedsLimit: boolean;
	readonly maxLines: number;
	readonly maxBytes: number;
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function byteLength(content: string): number {
	return new TextEncoder().encode(content).byteLength;
}

function splitLines(content: string): string[] {
	if (content.length === 0) return [];
	const lines = content.split("\n");
	if (content.endsWith("\n")) lines.pop();
	return lines;
}

export function truncateHead(content: string, options: { readonly maxLines?: number; readonly maxBytes?: number } = {}): Truncation {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const totalBytes = byteLength(content);
	const lines = splitLines(content);
	const totalLines = lines.length;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			lastLinePartial: false,
			firstLineExceedsLimit: false,
			maxLines,
			maxBytes,
		};
	}

	const firstLineBytes = byteLength(lines[0]);
	if (firstLineBytes > maxBytes) {
		return {
			content: "",
			truncated: true,
			truncatedBy: "bytes",
			totalLines,
			totalBytes,
			outputLines: 0,
			outputBytes: 0,
			lastLinePartial: false,
			firstLineExceedsLimit: true,
			maxLines,
			maxBytes,
		};
	}

	const kept: string[] = [];
	let keptBytes = 0;
	let truncatedBy: "lines" | "bytes" = "lines";
	for (let index = 0; index < lines.length && index < maxLines; index++) {
		const lineBytes = byteLength(lines[index]) + (index > 0 ? 1 : 0);
		if (keptBytes + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			break;
		}
		kept.push(lines[index]);
		keptBytes += lineBytes;
	}
	if (kept.length >= maxLines && keptBytes <= maxBytes) truncatedBy = "lines";

	const outputContent = kept.join("\n");
	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: kept.length,
		outputBytes: byteLength(outputContent),
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}
