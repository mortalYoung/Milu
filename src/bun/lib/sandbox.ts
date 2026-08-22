import { join } from "node:path";
import type { SandboxMode } from "../../shared/rpc";

const SANDBOX_MODES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

export const sandboxFilePath = (dir: string) => join(dir, "sandbox.json");

export function isSandboxMode(value: unknown): value is SandboxMode {
	return typeof value === "string" && (SANDBOX_MODES as string[]).includes(value);
}
