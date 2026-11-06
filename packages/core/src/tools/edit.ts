import { Type } from "typebox";

import { generateDiffString, generateUnifiedPatch } from "./diff.ts";
import { resolveToolPath } from "./path.ts";
import type { FileError } from "./result.ts";
import type { AgentHarnessTool, ExecutionToolContext } from "./types.ts";

interface Edit {
	readonly oldText: string;
	readonly newText: string;
}

interface EditInput {
	readonly path: string;
	readonly edits: { readonly oldText: string; readonly newText: string }[];
}

interface EditDetails {
	readonly diff: string;
	readonly patch: string;
	readonly firstChangedLine: number | undefined;
}

interface LineSpan {
	readonly start: number;
	readonly end: number;
}

interface Replacement {
	readonly matchIndex: number;
	readonly matchLength: number;
	readonly newText: string;
}

interface MatchResult {
	readonly found: boolean;
	readonly index: number;
	readonly matchLength: number;
	readonly usedFuzzyMatch: boolean;
	readonly contentForReplacement: string;
}

const replaceEditSchema = Type.Object(
	{
		oldText: Type.String({
			description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
		}),
		newText: Type.String({ description: "Replacement text for this targeted edit." }),
	},
	{},
);

const editSchema = Type.Object(
	{
		path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
		edits: Type.Array(replaceEditSchema, {
			description:
				"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
		}),
	},
	{},
);

function detectLineEnding(content: string): "\n" | "\r\n" {
	const crlfIndex = content.indexOf("\r\n");
	const lfIndex = content.indexOf("\n");
	if (lfIndex === -1) return "\n";
	if (crlfIndex === -1) return "\n";
	return crlfIndex < lfIndex ? "\r\n" : "\n";
}

function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function restoreLineEndings(text: string, ending: "\n" | "\r\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function stripBom(content: string): { readonly bom: string; readonly text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

function normalizeForFuzzyMatch(text: string): string {
	return text
		.normalize("NFKC")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function splitLinesWithEndings(content: string): string[] {
	return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function getLineSpans(content: string): LineSpan[] {
	let offset = 0;
	return splitLinesWithEndings(content).map((line) => {
		const span = { start: offset, end: offset + line.length };
		offset = span.end;
		return span;
	});
}

function getReplacementLineRange(lines: readonly LineSpan[], replacement: Replacement): { readonly startLine: number; readonly endLine: number } {
	const replacementStart = replacement.matchIndex;
	const replacementEnd = replacement.matchIndex + replacement.matchLength;
	let startLine = -1;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (replacementStart >= line.start && replacementStart < line.end) {
			startLine = index;
			break;
		}
	}
	if (startLine === -1) throw new Error("Replacement range is outside the base content.");
	let endLine = startLine;
	while (endLine < lines.length && lines[endLine].end < replacementEnd) endLine++;
	if (endLine >= lines.length) throw new Error("Replacement range is outside the base content.");
	return { startLine, endLine: endLine + 1 };
}

function applyReplacements(content: string, replacements: readonly Replacement[], offset = 0): string {
	let result = content;
	for (let index = replacements.length - 1; index >= 0; index--) {
		const replacement = replacements[index];
		const matchIndex = replacement.matchIndex - offset;
		result = result.substring(0, matchIndex) + replacement.newText + result.substring(matchIndex + replacement.matchLength);
	}
	return result;
}

function applyReplacementsPreservingUnchangedLines(originalContent: string, baseContent: string, replacements: readonly Replacement[]): string {
	const originalLines = splitLinesWithEndings(originalContent);
	const baseLines = getLineSpans(baseContent);
	if (originalLines.length !== baseLines.length) throw new Error("Cannot preserve unchanged lines because the base content has a different line count.");
	const groups: { startLine: number; endLine: number; replacements: Replacement[] }[] = [];
	const sortedReplacements = [...replacements].sort((left, right) => left.matchIndex - right.matchIndex);
	for (const replacement of sortedReplacements) {
		const range = getReplacementLineRange(baseLines, replacement);
		const current = groups[groups.length - 1];
		if (current && range.startLine < current.endLine) {
			current.endLine = Math.max(current.endLine, range.endLine);
			current.replacements.push(replacement);
			continue;
		}
		groups.push({ ...range, replacements: [replacement] });
	}
	let originalLineIndex = 0;
	let result = "";
	for (const group of groups) {
		result += originalLines.slice(originalLineIndex, group.startLine).join("");
		const groupStartOffset = baseLines[group.startLine].start;
		const groupEndOffset = baseLines[group.endLine - 1].end;
		result += applyReplacements(baseContent.slice(groupStartOffset, groupEndOffset), group.replacements, groupStartOffset);
		originalLineIndex = group.endLine;
	}
	result += originalLines.slice(originalLineIndex).join("");
	return result;
}

function fuzzyFindText(content: string, oldText: string): MatchResult {
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) return { found: true, index: exactIndex, matchLength: oldText.length, usedFuzzyMatch: false, contentForReplacement: content };
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
	if (fuzzyIndex === -1) return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false, contentForReplacement: content };
	return { found: true, index: fuzzyIndex, matchLength: fuzzyOldText.length, usedFuzzyMatch: true, contentForReplacement: fuzzyContent };
}

function countOccurrences(content: string, oldText: string): number {
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	return fuzzyContent.split(fuzzyOldText).length - 1;
}

function notFoundError(path: string, editIndex: number, totalEdits: number): Error {
	if (totalEdits === 1) return new Error(`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`);
	return new Error(`Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`);
}

function duplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
	if (totalEdits === 1) return new Error(`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`);
	return new Error(`Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`);
}

function emptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
	if (totalEdits === 1) return new Error(`oldText must not be empty in ${path}.`);
	return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

function noChangeError(path: string, totalEdits: number): Error {
	if (totalEdits === 1)
		return new Error(
			`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
		);
	return new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

interface MatchedEdit extends Replacement {
	readonly editIndex: number;
}

function applyEditsToNormalizedContent(normalizedContent: string, edits: readonly Edit[], path: string): { readonly baseContent: string; readonly newContent: string } {
	const normalizedEdits = edits.map((edit) => ({ oldText: normalizeToLF(edit.oldText), newText: normalizeToLF(edit.newText) }));
	for (let index = 0; index < normalizedEdits.length; index++) {
		if (normalizedEdits[index].oldText.length === 0) throw emptyOldTextError(path, index, normalizedEdits.length);
	}
	const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText));
	const usedFuzzyMatch = initialMatches.some((match) => match.usedFuzzyMatch);
	const replacementBaseContent = usedFuzzyMatch ? normalizeForFuzzyMatch(normalizedContent) : normalizedContent;
	const matchedEdits: MatchedEdit[] = [];
	for (let index = 0; index < normalizedEdits.length; index++) {
		const edit = normalizedEdits[index];
		const matchResult = fuzzyFindText(replacementBaseContent, edit.oldText);
		if (!matchResult.found) throw notFoundError(path, index, normalizedEdits.length);
		const occurrences = countOccurrences(replacementBaseContent, edit.oldText);
		if (occurrences > 1) throw duplicateError(path, index, normalizedEdits.length, occurrences);
		matchedEdits.push({ editIndex: index, matchIndex: matchResult.index, matchLength: matchResult.matchLength, newText: edit.newText });
	}
	matchedEdits.sort((left, right) => left.matchIndex - right.matchIndex);
	for (let index = 1; index < matchedEdits.length; index++) {
		const previous = matchedEdits[index - 1];
		const current = matchedEdits[index];
		if (previous.matchIndex + previous.matchLength > current.matchIndex) {
			throw new Error(`edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`);
		}
	}
	const baseContent = normalizedContent;
	const newContent = usedFuzzyMatch
		? applyReplacementsPreservingUnchangedLines(normalizedContent, replacementBaseContent, matchedEdits)
		: applyReplacements(replacementBaseContent, matchedEdits);
	if (baseContent === newContent) throw noChangeError(path, normalizedEdits.length);
	return { baseContent, newContent };
}

function parseJsonArray(value: string): unknown[] | undefined {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function prepareEditArguments(input: unknown): EditInput {
	const args = input as { path: unknown; edits?: unknown; oldText?: unknown; newText?: unknown };
	if (!args || typeof args !== "object") return args as unknown as EditInput;
	if (typeof args.edits === "string") {
		const parsed = parseJsonArray(args.edits);
		if (parsed !== undefined) args.edits = parsed;
	}
	if (typeof args.oldText !== "string" || typeof args.newText !== "string") return args as unknown as EditInput;
	const edits = Array.isArray(args.edits) ? [...args.edits] : [];
	edits.push({ oldText: args.oldText, newText: args.newText });
	const rest: Record<string, unknown> = { ...args };
	delete rest["oldText"];
	delete rest["newText"];
	return { ...rest, edits } as unknown as EditInput;
}

function validateEditInput(input: EditInput): EditInput {
	if (!Array.isArray(input.edits) || input.edits.length === 0) throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
	return { path: input.path, edits: input.edits };
}

function editAccessError(path: string, error: FileError): Error {
	return new Error(`Could not edit file: ${path}. Error code: ${error.code}.`, { cause: error });
}

export function createEditTool(): AgentHarnessTool<ExecutionToolContext, typeof editSchema, EditDetails> {
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
		parameters: editSchema,
		prepareArguments: prepareEditArguments,
		async execute(_toolCallId, input, signal, _onUpdate, { env }) {
			const { path, edits } = validateEditInput(input);
			const absolutePath = await resolveToolPath(env, path, signal);
			if (signal?.aborted) throw new Error("Operation aborted");
			const info = await env.fileInfo(absolutePath, signal);
			if (!info.ok) throw editAccessError(path, info.error);
			if (info.value.kind !== "file" && info.value.kind !== "symlink") throw new Error(`Could not edit file: ${path}. Path is not a file.`);
			const readResult = await env.readTextFile(absolutePath, signal);
			if (!readResult.ok) throw editAccessError(path, readResult.error);
			if (signal?.aborted) throw new Error("Operation aborted");
			const { bom, text: content } = stripBom(readResult.value);
			const originalEnding = detectLineEnding(content);
			const normalizedContent = normalizeToLF(content);
			const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);
			if (signal?.aborted) throw new Error("Operation aborted");
			const writeResult = await env.writeFile(absolutePath, bom + restoreLineEndings(newContent, originalEnding), signal);
			if (!writeResult.ok) throw editAccessError(path, writeResult.error);
			if (signal?.aborted) throw new Error("Operation aborted");
			const diffResult = generateDiffString(baseContent, newContent);
			return {
				content: [{ type: "text", text: `Successfully replaced ${edits.length} block(s) in ${path}.` }],
				details: { diff: diffResult.diff, patch: generateUnifiedPatch(path, baseContent, newContent), firstChangedLine: diffResult.firstChangedLine },
			};
		},
	};
}
