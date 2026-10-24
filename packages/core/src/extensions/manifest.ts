import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { WidgetType } from "@milu/protocol";

export const EXTENSION_API_VERSION = 1;

const WIDGET_TYPES: readonly WidgetType[] = ["slot", "widget", "dialog", "trigger", "service"];

export interface ManifestWidget {
	readonly id: string;
	readonly type: WidgetType;
	readonly entry: string;
	readonly export?: string;
}

export interface ManifestService {
	readonly id: string;
	readonly methods: readonly string[];
}

export interface ExtensionManifest {
	readonly id: string;
	readonly apiVersion: number;
	readonly widgets: readonly ManifestWidget[];
	readonly services: readonly ManifestService[];
	readonly contributions: Readonly<Record<string, readonly unknown[]>>;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what} is not an object`);
	return value as Record<string, unknown>;
}

function asWidgets(value: unknown): readonly ManifestWidget[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`"milu.widgets" is not an array`);
	return value.map((item, index) => {
		const widget = asRecord(item, `milu.widgets[${index}]`);
		if (typeof widget["id"] !== "string" || widget["id"] === "") throw new Error(`milu.widgets[${index}].id is not a string`);
		if (typeof widget["type"] !== "string" || !WIDGET_TYPES.includes(widget["type"] as WidgetType)) {
			throw new Error(`milu.widgets[${index}].type is not one of ${WIDGET_TYPES.join(", ")}`);
		}
		if (typeof widget["entry"] !== "string" || widget["entry"] === "") throw new Error(`milu.widgets[${index}].entry is not a string`);
		if (widget["export"] !== undefined && typeof widget["export"] !== "string") throw new Error(`milu.widgets[${index}].export is not a string`);
		return {
			id: widget["id"],
			type: widget["type"] as WidgetType,
			entry: widget["entry"],
			...(widget["export"] === undefined ? {} : { export: widget["export"] as string }),
		};
	});
}

export interface ManifestData {
	readonly from: "extension";
	readonly key: string;
}

export function isManifestData(value: unknown): value is ManifestData {
	return typeof value === "object" && value !== null && (value as { from?: unknown }).from === "extension" && typeof (value as { key?: unknown }).key === "string";
}

function asServices(value: unknown, extensionId: string): readonly ManifestService[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`"milu.services" is not an array`);
	return value.map((item, index) => {
		const service = asRecord(item, `milu.services[${index}]`);
		const id = service["id"];
		if (typeof id !== "string" || id === "") throw new Error(`milu.services[${index}].id is not a string`);
		if (!id.startsWith(`${extensionId}.`)) throw new Error(`milu.services[${index}].id "${id}" is outside the "${extensionId}." namespace`);
		const methods = service["methods"];
		if (!Array.isArray(methods) || methods.length === 0) throw new Error(`milu.services[${index}].methods is not a non-empty array`);
		const names = methods.map((method) => {
			if (typeof method !== "string" || method === "") throw new Error(`milu.services[${index}].methods contains a non-string`);
			return method;
		});
		if (new Set(names).size !== names.length) throw new Error(`milu.services[${index}].methods has duplicates`);
		return { id, methods: names };
	});
}

function asContributions(value: unknown): Readonly<Record<string, readonly unknown[]>> {
	if (value === undefined) return {};
	const contributions = asRecord(value, `"milu.contributions"`);
	for (const [point, items] of Object.entries(contributions)) {
		if (!Array.isArray(items)) throw new Error(`milu.contributions["${point}"] is not an array`);
	}
	return contributions as Readonly<Record<string, readonly unknown[]>>;
}

export async function readManifest(root: string, name: string): Promise<ExtensionManifest> {
	const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
	const milu = asRecord(manifest["milu"] ?? {}, `"milu" in ${name}/package.json`);

	const id = milu["id"] ?? manifest["name"];
	if (typeof id !== "string" || id === "") throw new Error(`${name}: "milu.id" and "name" are both missing`);

	const apiVersion = milu["apiVersion"] ?? 1;
	if (typeof apiVersion !== "number") throw new Error(`milu.apiVersion is not a number`);

	return {
		id,
		apiVersion,
		widgets: asWidgets(milu["widgets"]),
		services: asServices(milu["services"], id),
		contributions: asContributions(milu["contributions"]),
	};
}
