/**
 * Unit tests for the `@` picker's filter. Pure functions — no DOM, runs under bun test.
 */
import { describe, expect, test } from "bun:test";
import { filterMentions } from "../lib/mentions";

const partners = [{ name: "hutch" }, { name: "bob" }, { name: "roberta" }];

describe("filterMentions", () => {
	test("an empty query keeps the store's order", () => {
		expect(filterMentions(partners, "").map((p) => p.name)).toEqual(["hutch", "bob", "roberta"]);
	});

	test("a prefix ranks before an interior match", () => {
		expect(filterMentions(partners, "ro").map((p) => p.name)).toEqual(["roberta"]);
		expect(filterMentions(partners, "ob").map((p) => p.name)).toEqual(["bob", "roberta"]);
	});

	test("a miss is empty, not everything", () => {
		expect(filterMentions(partners, "zzz")).toEqual([]);
	});
});
