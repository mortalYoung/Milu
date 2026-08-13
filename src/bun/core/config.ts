import { dirname } from "node:path";

const databaseRoot = process.env["DATABASE_ROOT"];
if (!databaseRoot) {
	throw new Error("DATABASE_ROOT is not set — add it to .env");
}
export const DATABASE_ROOT: string = databaseRoot;
/** 项目根目录:作为会话的 cwd(pi 按 cwd 转义目录名)。 */
export const PROJECT_ROOT = dirname(DATABASE_ROOT);
