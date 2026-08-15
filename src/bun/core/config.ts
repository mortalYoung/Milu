import { dirname } from "node:path";

const databaseRoot = process.env["DATABASE_ROOT"];
if (!databaseRoot) {
	throw new Error("DATABASE_ROOT is not set — add it to .env");
}
export const DATABASE_ROOT: string = databaseRoot;
/** Project root: used as the session cwd (pi escapes directory names by cwd). */
export const PROJECT_ROOT = dirname(DATABASE_ROOT);
