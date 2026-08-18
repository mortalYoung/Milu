/**
 * Unit tests for the composer Enter decision (IME-safe) and workspace path formatting.
 * Pure functions — no DOM, runs under bun test.
 */
import { describe, expect, test } from "bun:test";
import { formatWorkspacePath, shouldSendOnEnter } from "../lib/composer-input";

describe("shouldSendOnEnter IME-safe Enter decision", () => {
	const english = { keyCode: 13, shiftKey: false, repeat: false, composing: false, isComposing: false };

	test("plain English Enter sends", () => {
		expect(shouldSendOnEnter(english)).toBe(true);
	});

	test("non-Enter keys never send", () => {
		expect(shouldSendOnEnter({ ...english, keyCode: 32 })).toBe(false);
		expect(shouldSendOnEnter({ ...english, keyCode: 229 })).toBe(false);
	});

	test("Shift+Enter newline, decided before the IME guard", () => {
		// even mid-composition a Shift+Enter still breaks the line
		expect(shouldSendOnEnter({ ...english, shiftKey: true })).toBe(false);
		expect(shouldSendOnEnter({ ...english, shiftKey: true, composing: true, isComposing: true })).toBe(false);
	});

	test("composition Enter (Chinese IME candidate confirm, keyCode 13) must not send", () => {
		expect(shouldSendOnEnter({ ...english, composing: true })).toBe(false);
		expect(shouldSendOnEnter({ ...english, isComposing: true })).toBe(false);
		// legacy engines signal composition with keyCode 229 instead of isComposing
		expect(shouldSendOnEnter({ ...english, keyCode: 229, isComposing: false, composing: false })).toBe(false);
	});

	test("auto-repeat Enter must not machine-gun sends", () => {
		expect(shouldSendOnEnter({ ...english, repeat: true })).toBe(false);
	});
});

describe("formatWorkspacePath middle truncation", () => {
	test("short path passes through unchanged", () => {
		expect(formatWorkspacePath("/Users/xiuneng/Projects/letters")).toBe("/Users/xiuneng/Projects/letters");
	});

	test("long path keeps head and tail with an ellipsis", () => {
		const path = "/Users/xiuneng/Projects/very-long-project-name-that-exceeds-the-limit/src/mainview";
		const out = formatWorkspacePath(path);
		expect(out).toContain("…");
		expect(out.length).toBeLessThan(path.length);
		expect(out.endsWith("mainview")).toBe(true);
		expect(out.startsWith("/Users/xiuneng/Pro")).toBe(true);
	});

	test("custom max respected", () => {
		const out = formatWorkspacePath("/a/very/long/path/indeed", 12);
		expect(out.length).toBeLessThanOrEqual(13); // head + … + tail
		expect(out).toContain("…");
	});
});
