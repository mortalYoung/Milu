import { createServiceId, type Service } from "@milu/di";
import type { ActionBinding, Hotkey, Platform } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

export interface ComposerKey {
	readonly key: string;
	readonly code: string;
	readonly shift: boolean;
	readonly meta: boolean;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly isComposing: boolean;
}

const SYMBOLS: Readonly<Record<string, string>> = { mod: "⌘", cmd: "⌘", meta: "⌘", shift: "⇧", alt: "⌥", option: "⌥", ctrl: "⌃", control: "⌃" };

export function formatHotkey(hotkey: Hotkey, platform: Platform): string {
	const chord = typeof hotkey === "string" ? hotkey : hotkey[platform];
	return chord
		.split("+")
		.map((part) => {
			const token = part.trim();
			return SYMBOLS[token.toLowerCase()] ?? (token.length === 1 ? token.toUpperCase() : token);
		})
		.join("");
}

interface Chord {
	readonly key: string;
	readonly shift: boolean;
	readonly meta: boolean;
	readonly ctrl: boolean;
	readonly alt: boolean;
}

function chordOf(hotkey: Hotkey, platform: Platform): Chord {
	const parts = (typeof hotkey === "string" ? hotkey : hotkey[platform]).toLowerCase().split("+");
	const key = parts.pop()?.trim() ?? "";
	return {
		key,
		shift: parts.includes("shift"),
		meta: parts.includes("mod") || parts.includes("cmd") || parts.includes("meta"),
		ctrl: parts.includes("ctrl") || parts.includes("control"),
		alt: parts.includes("alt") || parts.includes("option"),
	};
}

function codeOf(key: string): string {
	if (/^[a-z]$/.test(key)) return `key${key}`;
	if (/^[0-9]$/.test(key)) return `digit${key}`;
	return key;
}

function claims(chord: Chord, key: ComposerKey): boolean {
	const named = chord.key === key.key.toLowerCase() || codeOf(chord.key) === key.code.toLowerCase();
	return named && chord.shift === key.shift && chord.meta === key.meta && chord.ctrl === key.ctrl && chord.alt === key.alt;
}

export class HotkeysService implements Service {
	readonly store = createStore<{ bindings: readonly ActionBinding[] }>()(() => ({ bindings: [] }));

	constructor(readonly platform: Platform) {}

	apply(bindings: readonly ActionBinding[]): void {
		this.store.setState({ bindings }, true);
	}

	match(key: ComposerKey, active: ReadonlySet<string>): ActionBinding | null {
		for (const binding of this.store.getState().bindings) {
			if (!binding.scopes.every((scope) => active.has(scope))) continue;
			if (claims(chordOf(binding.hotkey, this.platform), key)) return binding;
		}
		return null;
	}

	dispose(): void {}
}

export const IHotkeysService = createServiceId<HotkeysService>("HotkeysService");
