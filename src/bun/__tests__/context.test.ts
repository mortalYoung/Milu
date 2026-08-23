/**
 * AgentContext unit tests: lifecycle values (turn count / running state / progress-notification clock / reset) and prompt assembly.
 */
import { describe, expect, test } from "bun:test";
import { AgentContext } from "../core/context";
import { buildSystemPrompt } from "../core/prompt";

const INTERVAL = 20_000;

describe("AgentContext lifecycle", () => {
	test("beginTurn increments per turn", () => {
		const ctx = new AgentContext();
		expect(ctx.beginTurn()).toBe(1);
		expect(ctx.beginTurn()).toBe(2);
		expect(ctx.turn).toBe(2);
	});

	test("endTurn records the timestamp; setRunning toggles the running state", () => {
		const ctx = new AgentContext();
		ctx.endTurn();
		expect(ctx.lastTurnEndAt).toBeGreaterThan(0);
		ctx.setRunning(true);
		expect(ctx.running).toBe(true);
		ctx.setRunning(false);
		expect(ctx.running).toBe(false);
	});

	test("no visible message for over 20s → progress reminder triggers", () => {
		const ctx = new AgentContext();
		ctx.lastVisibleAt = Date.now() - (INTERVAL + 5_000);
		expect(ctx.shouldNotify()).toBe(true);
	});

	test("visible activity within 20s (user message or send_message) → does not trigger", () => {
		const ctx = new AgentContext();
		ctx.lastVisibleAt = Date.now() - 5_000;
		expect(ctx.shouldNotify()).toBe(false);
	});

	test("after triggering, cooldown prevents repeated reminders", () => {
		const ctx = new AgentContext();
		ctx.lastVisibleAt = Date.now() - (INTERVAL + 5_000);
		ctx.lastNudgeAt = Date.now() - 10_000;
		expect(ctx.shouldNotify()).toBe(false); // only 10s since the last reminder
		ctx.lastNudgeAt = 0;
		expect(ctx.shouldNotify()).toBe(true); // cooldown has passed
	});

	test("markUserMessage / markVisible refresh the visible clock", () => {
		const ctx = new AgentContext();
		ctx.lastVisibleAt = Date.now() - 60_000;
		ctx.markUserMessage();
		expect(ctx.visibleElapsedMs()).toBeLessThan(1_000);
		ctx.markVisible();
		expect(ctx.visibleElapsedMs()).toBeLessThan(1_000);
		expect(ctx.shouldNotify()).toBe(false);
	});

	test("reset clears counters and restarts the clock", () => {
		const ctx = new AgentContext();
		ctx.beginTurn();
		ctx.setRunning(true);
		ctx.lastVisibleAt = 0;
		ctx.reset();
		expect(ctx.turn).toBe(0);
		expect(ctx.running).toBe(false);
		expect(ctx.visibleElapsedMs()).toBeLessThan(1_000);
		expect(ctx.lastNudgeAt).toBe(0);
	});
});

describe("AgentContext prompt assembly", () => {
	test("composeSystemPrompt has all sections after setPartner", () => {
		const ctx = new AgentContext();
		ctx.setPartner({ responsibilities: "Ship features" });
		const p = ctx.composeSystemPrompt();
		expect(p).toContain("# IDENTIFY");
		expect(p).toContain("You are an agent running in Partner App.");
		expect(p).toContain("# RESPONSE-FORMAT");
	});

	test("previewSystemPrompt uses the passed profile, does not change the current context", () => {
		const ctx = new AgentContext();
		ctx.setPartner({ responsibilities: "A" });
		const preview = ctx.previewSystemPrompt({ responsibilities: "B" });
		expect(preview).toContain("B");
		expect(ctx.composeSystemPrompt()).toContain("A");
	});

	test("composeSystemPrompt always includes the fixed PERSONA sentence", () => {
		const ctx = new AgentContext();
		const p = ctx.composeSystemPrompt();
		expect(p).toContain("# PERSONA");
		expect(p).toContain("You are an agent running in Partner App.");
		expect(p.indexOf("# IDENTIFY")).toBeLessThan(p.indexOf("# PERSONA"));
		expect(buildSystemPrompt !== undefined).toBe(true);
	});

	test("WORKSPACE and STORAGE are always included and static (paths arrive via reminder, not the prompt)", () => {
		const ctx = new AgentContext();
		ctx.storage_path = "/tmp/storage";
		ctx.workspace_path = "/tmp/ws";
		const p = ctx.composeSystemPrompt();
		expect(p).toContain("# WORKSPACE");
		expect(p).toContain("# STORAGE");
		expect(p).not.toContain("/tmp/storage");
		expect(p).not.toContain("/tmp/ws");
		expect(p).toBe(ctx.composeSystemPrompt());
	});
});
