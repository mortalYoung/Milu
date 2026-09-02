import { describe, expect, test } from "bun:test";
import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENTS } from "../../shared/events";
import { cleanOrigin } from "../../shared/origin";

function entry(id: string, type: Entry["type"], customType?: string, data?: unknown): Entry {
	return { id, type, ...(customType ? { customType } : {}), ...(data !== undefined ? { data } : {}) } as unknown as Entry;
}

const header = (id: string, systemPrompt: string, toolNames: string[]) => entry(id, "custom", EVENTS.requestHeader, { systemPrompt, toolNames });

describe("cleanOrigin", () => {
	test("keeps every distinct request/header, dropping later identical ones", () => {
		const raw = [
			header("h1", "sys A", ["bash"]),
			header("h2", "sys B", ["read"]),
			header("h3", "sys A", ["bash"]), // duplicate content
			entry("u1", "message"),
		];
		const origin = cleanOrigin(raw);
		expect(origin.map((e) => e.id)).toEqual(["h1", "h2", "u1"]);
	});

	test("keeps identical headers with different tool sets (distinct key)", () => {
		const raw = [header("h1", "sys", ["bash"]), header("h2", "sys", ["read"])];
		expect(cleanOrigin(raw).map((e) => e.id)).toEqual(["h1", "h2"]);
	});

	test("drops entries without a usable id", () => {
		const raw = [entry("", "message"), entry("ok", "message"), { id: null } as unknown as Entry];
		expect(cleanOrigin(raw).map((e) => e.id)).toEqual(["ok"]);
	});

	test("passes through non-header entries untouched", () => {
		const raw = [entry("m1", "message"), entry("t1", "custom", EVENTS.toolResult, { toolCallId: "c1" })];
		expect(cleanOrigin(raw)).toEqual(raw);
	});
});
