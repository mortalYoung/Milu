import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const TIMEOUT_MS = 5 * 60_000;

export async function pickDirectory(startingFolder?: string): Promise<string | undefined> {
	if (process.platform !== "darwin") return undefined;

	const start = startingFolder ? ` default location POSIX file ${JSON.stringify(startingFolder)}` : "";
	try {
		const { stdout } = await run("osascript", ["-e", `POSIX path of (choose folder with prompt "Choose a folder"${start})`], { timeout: TIMEOUT_MS });
		const path = stdout.trim().replace(/\/$/, "");
		return path === "" ? undefined : path;
	} catch {
		return undefined;
	}
}
