import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface PartnerUsagePart {
	label: string;
	bytes: number;
}

async function sizeOf(path: string): Promise<number> {
	const info = await lstat(path).catch(() => null);
	if (!info) return 0;
	if (!info.isDirectory()) return info.size;
	const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
	let total = 0;
	for (const entry of entries) total += await sizeOf(join(path, entry.name));
	return total;
}

async function partLabel(path: string, name: string, isDirectory: boolean): Promise<string> {
	if (!isDirectory) return "config";
	if (name === ".memory") return "memory";
	if (name === "storage") return "storage";
	const entries = await readdir(path).catch(() => []);
	return entries.some((file) => file.endsWith(".jsonl")) ? "sessions" : name;
}

export async function partnerUsage(dir: string): Promise<{ bytes: number; parts: PartnerUsagePart[] }> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const parts = new Map<string, number>();
	let bytes = 0;
	for (const entry of entries) {
		const path = join(dir, entry.name);
		const size = await sizeOf(path);
		bytes += size;
		const label = await partLabel(path, entry.name, entry.isDirectory());
		parts.set(label, (parts.get(label) ?? 0) + size);
	}
	return {
		bytes,
		parts: [...parts].map(([label, partBytes]) => ({ label, bytes: partBytes })).sort((a, b) => b.bytes - a.bytes),
	};
}
