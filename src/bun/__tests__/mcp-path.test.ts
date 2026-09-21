import { describe, expect, test } from "bun:test";
import { withFallbackPath } from "../mcp/manager";

describe("mcp server PATH", () => {
	test("keeps the inherited PATH first and appends the usual bin dirs", () => {
		const path = withFallbackPath("/usr/bin:/bin", "/home/tester");
		expect(path.startsWith("/usr/bin:/bin:")).toBe(true);
		expect(path).toContain("/opt/homebrew/bin");
		expect(path).toContain("/home/tester/.bun/bin");
	});

	test("a bare launchd PATH still reaches homebrew and bun", () => {
		const path = withFallbackPath("/usr/bin:/bin:/usr/sbin:/sbin", "/home/tester");
		expect(path.split(":")).toContain("/opt/homebrew/bin");
		expect(path.split(":")).toContain("/home/tester/.local/bin");
	});

	test("empty inherited PATH does not leave a leading colon", () => {
		expect(withFallbackPath("", "/home/tester").startsWith(":")).toBe(false);
	});
});
