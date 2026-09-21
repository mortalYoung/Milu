import { describe, expect, test } from "bun:test";
import { classifyReader, compensatedTop, distanceToBottom, FOLLOW_THRESHOLD, floorTop, isAtBottom } from "../lib/scroll-anchor";

describe("follow threshold", () => {
	test("FOLLOW_THRESHOLD is 24px, at bottom means ≤ 24 + 1", () => {
		expect(FOLLOW_THRESHOLD).toBe(24);
		expect(isAtBottom(25)).toBe(true);
		expect(isAtBottom(26)).toBe(false);
		expect(isAtBottom(0)).toBe(true);
		expect(distanceToBottom(1000, 690, 300)).toBe(10);
	});
});

describe("observed-top ledger", () => {
	test("program write matches observedTop → not reader", () => {
		expect(classifyReader(700, 700, 1000)).toBe(false);
	});
	test("shrink clamp: scrollTop equals min(observedTop, floor) → program (keep following)", () => {
		expect(classifyReader(500, 700, 500)).toBe(false);
	});
	test("compositor-first: browser advanced geometry before the scroll event → reader input", () => {
		expect(classifyReader(500, 700, 1000)).toBe(true);
	});
	test("0.5px tolerance: small rounding is program, real movement is reader", () => {
		expect(classifyReader(700.4, 700, 1000)).toBe(false);
		expect(classifyReader(700.6, 700, 1000)).toBe(true);
	});
});

describe("floor", () => {
	test("clamps at zero when content is shorter than the viewport", () => {
		expect(floorTop(100, 200)).toBe(0);
		expect(floorTop(300, 200)).toBe(100);
	});
});

describe("prepend compensation", () => {
	test("reference §14.1: reader at 90, anchor row displaced by 500 → 590", () => {
		expect(compensatedTop({ scrollTop: 90, anchorTop: 0 }, 500, 0)).toBe(590);
	});
	test("reference §14.2: reader at 80, anchor row displaced by 600 → 680", () => {
		expect(compensatedTop({ scrollTop: 80, anchorTop: 0 }, 600, 0)).toBe(680);
	});
	test("scrollport offset is included in the flow measurement", () => {
		expect(compensatedTop({ scrollTop: 100, anchorTop: 20 }, 300, 50)).toBe(330);
	});
});
