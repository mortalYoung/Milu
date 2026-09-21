import { describe, expect, test } from "bun:test";
import {
	classifyReader,
	compensatedTop,
	distanceToBottom,
	FOLLOW_THRESHOLD,
	floorTop,
	hadRecentInput,
	INPUT_CONCURRENT_MS,
	INPUT_WINDOW_MS,
	inputWindowFor,
	isAtBottom,
	looksForeign,
} from "../lib/scroll-anchor";

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

describe("input window", () => {
	test("input inside the window explains a scroll, outside it does not", () => {
		expect(hadRecentInput(0)).toBe(true);
		expect(hadRecentInput(INPUT_WINDOW_MS)).toBe(true);
		expect(hadRecentInput(INPUT_WINDOW_MS + 1)).toBe(false);
	});
	test("a one-screen jump with no input since is foreign", () => {
		expect(looksForeign(-13435, 687, 5000)).toBe(true);
	});
	test("input concurrent with a big jump keeps it as reader input (flick, momentum)", () => {
		expect(looksForeign(-13435, 687, 60)).toBe(false);
	});
	test("a big jump is foreign once input is older than the concurrent window", () => {
		expect(inputWindowFor(-13435, 687)).toBe(INPUT_CONCURRENT_MS);
		expect(looksForeign(-13435, 687, INPUT_CONCURRENT_MS + 1)).toBe(true);
	});
	test("a moderate jump still trusts the longer window (a scroll ended just before)", () => {
		expect(inputWindowFor(-1200, 687)).toBe(INPUT_WINDOW_MS);
		expect(looksForeign(-1200, 687, 300)).toBe(false);
	});
	test("a sub-viewport step with no input stays reader input (scrollbar drag)", () => {
		expect(looksForeign(-400, 687, 5000)).toBe(false);
	});
	test("exactly one viewport is not enough to call it foreign", () => {
		expect(looksForeign(687, 687, 5000)).toBe(false);
		expect(looksForeign(688, 687, 5000)).toBe(true);
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
		expect(compensatedTop(90, 500, 0, 0)).toBe(590);
	});
	test("reference §14.2: reader at 80, anchor row displaced by 600 → 680", () => {
		expect(compensatedTop(80, 600, 0, 0)).toBe(680);
	});
	test("scrollport offset is included in the flow measurement", () => {
		expect(compensatedTop(100, 300, 50, 20)).toBe(330);
	});
	test("the base is the live scroll position, not the one captured with the anchor", () => {
		// 日志实测：停驻时 top=12602，被浏览器挪到 5101 后内容重排（锚点行 flow=7518，anchorTop=16.692）。
		const anchorTop = 16.692;
		const rowTop = 7518;
		// 实时基准 → 回到读者的 12602；用捕获基准 → 20103（超出 max，被夹到底 = 旧 bug）
		expect(compensatedTop(5101, rowTop, 0, anchorTop)).toBeCloseTo(12602.31, 2);
		expect(compensatedTop(12602, rowTop, 0, anchorTop)).toBeCloseTo(20103.31, 2);
	});
	test("compensation puts the anchor row back at its recorded offset, whatever the drift was", () => {
		const anchorTop = 24;
		const rowTop = 900;
		const portTop = 12;
		const target = compensatedTop(420, rowTop, portTop, anchorTop);
		// 补偿后锚点行的内容坐标 = 现在的视图位置 + 记录时的偏移
		expect(target + anchorTop).toBe(420 + (rowTop - portTop));
	});
});
