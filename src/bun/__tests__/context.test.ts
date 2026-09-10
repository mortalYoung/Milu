import { describe, expect, test } from "bun:test";
import { Context } from "../core/context";
import { buildSystemPrompt } from "../core/prompt";

describe("Context lifecycle", () => {
	test("beginTurn increments per turn", () => {
		const ctx = new Context();
		expect(ctx.beginTurn()).toBe(1);
		expect(ctx.beginTurn()).toBe(2);
		expect(ctx.turn).toBe(2);
	});

	test("endTurn records the timestamp; setRunning toggles the running state", () => {
		const ctx = new Context();
		ctx.endTurn();
		expect(ctx.lastTurnEndAt).toBeGreaterThan(0);
		ctx.setRunning(true);
		expect(ctx.running).toBe(true);
		ctx.setRunning(false);
		expect(ctx.running).toBe(false);
	});

	test("markUserMessage / markVisible refresh the visible clock", () => {
		const ctx = new Context();
		ctx.lastVisibleAt = Date.now() - 60_000;
		ctx.markUserMessage();
		expect(ctx.visibleElapsedMs()).toBeLessThan(1_000);
		ctx.markVisible();
		expect(ctx.visibleElapsedMs()).toBeLessThan(1_000);
	});

	test("reset clears counters and restarts the clock", () => {
		const ctx = new Context();
		ctx.beginTurn();
		ctx.setRunning(true);
		ctx.lastVisibleAt = 0;
		ctx.reset();
		expect(ctx.turn).toBe(0);
		expect(ctx.running).toBe(false);
		expect(ctx.visibleElapsedMs()).toBeLessThan(1_000);
	});
});

describe("Context prompt assembly", () => {
	test("composeSystemPrompt has all sections after setPartner", () => {
		const ctx = new Context();
		ctx.setPartner({ persona: "Ship features" });
		const p = ctx.composeSystemPrompt();
		expect(p).toContain("# IDENTIFY");
		expect(p).toContain("You are a helpful software engineer assistant");
		expect(p).toContain("# STORAGE");
	});

	test("composeSystemPrompt includes PERSONA when persona exists", () => {
		const ctx = new Context();
		ctx.setPartner({ persona: "Ship features" });
		const p = ctx.composeSystemPrompt();
		expect(p).toContain("# PERSONA");
		expect(p).toContain("Ship features");
		expect(p.indexOf("# IDENTIFY")).toBeLessThan(p.indexOf("# PERSONA"));
		expect(buildSystemPrompt !== undefined).toBe(true);
	});

	test("WORKING DIRECTORY and STORAGE are always included and static (paths arrive via reminder, not the prompt)", () => {
		const ctx = new Context();
		ctx.storage_path = "/tmp/storage";
		ctx.workspace_path = "/tmp/ws";
		const p = ctx.composeSystemPrompt();
		expect(p).toContain("# WORKING DIRECTORY");
		expect(p).toContain("# STORAGE");
		expect(p).not.toContain("/tmp/storage");
		expect(p).not.toContain("/tmp/ws");
		expect(p).toBe(ctx.composeSystemPrompt());
	});
});
