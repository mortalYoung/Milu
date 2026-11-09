import { resolve } from "node:path";

import { expandHome } from "@milu/core";

import { canonicalCandidate, isInside } from "./roots.ts";

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const DENIED_KEYS = new Set([
	"PATH",
	"HOME",
	"SHELL",
	"USER",
	"LOGNAME",
	"TMPDIR",
	"PWD",
	"OLDPWD",
	"IFS",
	"ENV",
	"BASH_ENV",
	"NODE_OPTIONS",
	"GIT_SSH_COMMAND",
	"GIT_EXTERNAL_DIFF",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"ALL_PROXY",
	"NO_PROXY",
]);
const DENIED_PREFIXES = ["LD_", "DYLD_", "BASH_", "ZSH_", "NODE_", "PYTHON", "PERL", "RUBY", "MILU_"];
const HOME_VARIABLE = "MILU_PERMISSION_HOME";
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const MAX_VALUE_LENGTH = 1024;

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 && code !== 0x09) return true;
	}
	return false;
}

function reject(key: string, reason: string): never {
	throw new Error(`settings "sandboxEnv.${key}" ${reason}`);
}

function expand(value: string, root: string, key: string): string {
	const text = value.split(`\${${HOME_VARIABLE}}`).join(root).split(`$${HOME_VARIABLE}`).join(root);
	if (text.includes("$")) reject(key, `may only reference $${HOME_VARIABLE}`);
	return text.startsWith("~") ? expandHome(text) : text;
}

function requireInside(root: string, key: string, value: string): void {
	const path = canonicalCandidate(resolve(value));
	if (path === root || isInside(path, root)) return;
	reject(key, `must stay inside ${root}, got ${path}`);
}

export function resolveSandboxEnv(value: unknown, exemptRoot: string): Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error('settings "sandboxEnv" must be a mapping of variable name to string');
	const root = canonicalCandidate(resolve(exemptRoot));
	const resolved: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (!KEY_PATTERN.test(key)) reject(key, "must match ^[A-Z][A-Z0-9_]*$");
		if (DENIED_KEYS.has(key) || DENIED_PREFIXES.some((prefix) => key.startsWith(prefix))) reject(key, "is reserved");
		if (typeof raw !== "string") reject(key, "must be a string");
		if (raw.length > MAX_VALUE_LENGTH) reject(key, `must be at most ${MAX_VALUE_LENGTH} characters`);
		if (hasControlCharacter(raw)) reject(key, "must not contain control characters");
		const expanded = expand(raw, root, key);
		if (URL_PATTERN.test(expanded)) {
			resolved[key] = expanded;
			continue;
		}
		for (const segment of expanded.split(":")) {
			if (segment === "" || URL_PATTERN.test(segment) || !segment.includes("/")) continue;
			requireInside(root, key, segment);
		}
		resolved[key] = expanded;
	}
	return resolved;
}
