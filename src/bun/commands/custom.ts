import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CommandKind, CommandResult } from "../../shared/rpc";
import type { CommandDefinition, CommandInvocation } from "./types";

export interface CustomCommandModule {
	name?: string;
	description?: string;
	kind?: CommandKind;
	hint?: string;
	timeout?: number;
	recordInput?: boolean;
	handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}

export async function loadCustomCommands(dir: string): Promise<{ defs: CommandDefinition[]; errors: string[] }> {
	await mkdir(dir, { recursive: true });
	const entries = await readdir(dir, { withFileTypes: true });
	const files = entries
		.filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !e.name.startsWith("_") && !e.name.startsWith("."))
		.map((e) => join(dir, e.name));
	const defs: CommandDefinition[] = [];
	const errors: string[] = [];
	for (const file of files) {
		const name = basename(file, ".ts");
		try {
			const href = `${pathToFileURL(file).href}?t=${Date.now()}`;
			const mod = (await import(href)) as { command?: CustomCommandModule };
			if (!mod.command || typeof mod.command.handler !== "function") {
				errors.push(`${file}: missing export const command with a handler`);
				continue;
			}
			const c = mod.command;
			const def: CommandDefinition = {
				name: c.name ?? name,
				description: c.description ?? name,
				kind: c.kind ?? (c.hint ? "leadingInput" : "execute"),
				...(c.hint ? { hint: c.hint } : {}),
				...(c.recordInput !== undefined ? { recordInput: c.recordInput } : {}),
				handler: async (invocation) => c.handler(invocation),
			};
			const err = validateCustomCommand(def);
			if (err) {
				errors.push(`${file}: ${err}`);
				continue;
			}
			if (def.name !== name) {
				errors.push(`${file}: command name "${def.name}" must match filename "${name}"`);
				continue;
			}
			defs.push(def);
		} catch (error) {
			errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { defs, errors };
}

export function validateCustomCommand(def: CommandDefinition): string | null {
	if (!/^[a-z][a-z0-9_-]{0,31}$/.test(def.name)) return `invalid command name "${def.name}"`;
	if (def.description.length === 0 || def.description.length > 200) return "description must be 1-200 characters";
	if (def.kind !== "execute" && def.kind !== "leadingInput") return "kind must be execute or leadingInput";
	if (def.kind === "leadingInput" && !def.hint) return "leadingInput command needs a hint";
	return null;
}

export function mergeCommandDefinitions(defaults: CommandDefinition[], customs: CommandDefinition[]): { defs: CommandDefinition[]; errors: string[] } {
	const byName = new Map<string, CommandDefinition>();
	const errors: string[] = [];
	for (const def of defaults) byName.set(def.name, def);
	for (const def of customs) {
		if (byName.has(def.name)) {
			errors.push(`command /${def.name} collides with a built-in command`);
			continue;
		}
		byName.set(def.name, def);
	}
	return { defs: [...byName.values()], errors };
}
