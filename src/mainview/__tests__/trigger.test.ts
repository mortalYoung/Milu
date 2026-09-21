/**
 * Unit tests for slash-trigger detection and command parsing.
 * Pure functions — no DOM, runs under bun test.
 */
import { describe, expect, test } from "bun:test";
import { filterCommands } from "../lib/commands";
import { detectTrigger, parseCommand } from "../lib/trigger";

describe("detectTrigger caret-left scan + word boundary", () => {
	test("leading slash opens a trigger", () => {
		expect(detectTrigger("/com", 4)).toEqual({ trigger: "/", query: "com", position: "leading", span: { start: 0, end: 4 } });
	});

	test("empty query after slash", () => {
		expect(detectTrigger("/", 1)).toEqual({ trigger: "/", query: "", position: "leading", span: { start: 0, end: 1 } });
	});

	test("after whitespace is a boundary", () => {
		expect(detectTrigger("hello /com", 10)).toEqual({ trigger: "/", query: "com", position: "inline", span: { start: 6, end: 10 } });
	});

	test("after punctuation is a boundary", () => {
		expect(detectTrigger("see,/com", 8)).toEqual({ trigger: "/", query: "com", position: "inline", span: { start: 4, end: 8 } });
	});

	test("slash glued to a word (URL path) is not a boundary", () => {
		expect(detectTrigger("https://example.com/foo", 23)).toBeNull();
	});

	test("second slash of // does not create its own trigger (the leading one still can)", () => {
		expect(detectTrigger("//foo", 5)).toEqual({ trigger: "/", query: "/foo", position: "leading", span: { start: 0, end: 5 } });
	});

	test("user@host slash is not a boundary", () => {
		expect(detectTrigger("user@host/foo", 14)).toBeNull();
	});

	test("whitespace before the caret stops the scan", () => {
		expect(detectTrigger("/com later", 5)).toBeNull();
	});
});

describe("parseCommand exact command-name parse", () => {
	test("parses leading command with raw input", () => {
		expect(parseCommand("/workspace ~/src")).toEqual({ name: "workspace", rawInput: " ~/src" });
	});

	test("bare command keeps empty raw input", () => {
		expect(parseCommand("/compact")).toEqual({ name: "compact", rawInput: "" });
	});

	test("non-leading text is not a command", () => {
		expect(parseCommand("see /help")).toBeNull();
	});

	test("uppercase or digit-leading name is not a command", () => {
		expect(parseCommand("/Model")).toBeNull();
		expect(parseCommand("/9abc")).toBeNull();
	});

	test("space terminates the name and becomes raw input", () => {
		expect(parseCommand("/has space")).toEqual({ name: "has", rawInput: " space" });
	});
});

describe("filterCommands menu search", () => {
	const commands = [
		{ name: "compact", description: "a", kind: "execute" as const },
		{ name: "clear", description: "b", kind: "execute" as const },
		{ name: "workspace", description: "c", kind: "leadingInput" as const, hint: "[<path>]" },
	];

	test("empty query returns everything", () => {
		expect(filterCommands(commands, "")).toHaveLength(3);
	});

	test("prefix match ranks before includes", () => {
		const out = filterCommands(commands, "c");
		expect(out.map((c) => c.name)).toEqual(["clear", "compact", "workspace"]);
	});
});
