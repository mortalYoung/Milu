import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface LmeTurn {
	readonly role: string;
	readonly content: unknown;
	readonly has_answer?: boolean;
}

interface LmeInstance {
	readonly question_id: string;
	readonly question_type: string;
	readonly question: string;
	readonly answer: string;
	readonly haystack_sessions: readonly (readonly LmeTurn[])[];
	readonly haystack_dates: readonly string[];
	readonly answer_session_ids?: readonly string[];
}

interface FixtureMessage {
	readonly role: "user" | "assistant";
	readonly content: string;
	readonly at: string;
}

interface FixtureQuestion {
	readonly id: string;
	readonly ability: string;
	readonly history: readonly FixtureMessage[];
	readonly question: string;
	readonly answer: string;
}

const BUCKETS = ["single-session", "multi-session", "knowledge-update", "temporal", "abstention"] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketOf(instance: LmeInstance): Bucket {
	if (instance.question_id.endsWith("_abs")) return "abstention";
	const type = instance.question_type;
	if (type === "temporal-reasoning") return "temporal";
	if (type === "knowledge-update") return "knowledge-update";
	if (type === "multi-session") return "multi-session";
	return "single-session";
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			const text = (part as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.join(" ");
}

function dayOf(stamp: string): number {
	const parsed = Date.parse(stamp);
	if (!Number.isNaN(parsed)) return parsed;
	const match = /(\d{4})[/-](\d{2})[/-](\d{2})(?:[^\d]+(\d{2}):(\d{2}))?/.exec(stamp);
	if (match === null) return Date.now();
	const [, year, month, day, hour, minute] = match;
	return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour ?? "0"), Number(minute ?? "0"));
}

function historyOf(instance: LmeInstance): FixtureMessage[] {
	const messages: FixtureMessage[] = [];
	for (const [index, session] of instance.haystack_sessions.entries()) {
		const start = dayOf(instance.haystack_dates[index] ?? "") + index * 3600_000;
		for (const [turn, entry] of session.entries()) {
			if (entry.role !== "user" && entry.role !== "assistant") continue;
			const content = textOf(entry.content).trim();
			if (content === "") continue;
			messages.push({ role: entry.role, content, at: new Date(start + turn * 60_000).toISOString() });
		}
	}
	return messages;
}

function spread<T>(items: readonly T[], take: number): T[] {
	if (items.length <= take) return [...items];
	return Array.from({ length: take }, (_, index) => items[Math.floor((index * items.length) / take)]!);
}

function arg(argv: readonly string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index < 0 ? undefined : argv[index + 1];
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const source = arg(argv, "--in");
	const target = arg(argv, "--out") ?? "artifacts/memory-bench/lme-50.json";
	const per = Number(arg(argv, "--per") ?? "10");
	if (source === undefined) throw new Error("usage: bun scripts/lme-sample.ts --in <longmemeval_s_cleaned.json> [--out file] [--per 10]");

	const all = JSON.parse(await readFile(source, "utf8")) as readonly LmeInstance[];
	const grouped = new Map<Bucket, LmeInstance[]>();
	for (const instance of all) {
		const bucket = bucketOf(instance);
		const list = grouped.get(bucket) ?? [];
		list.push(instance);
		grouped.set(bucket, list);
	}

	const questions: FixtureQuestion[] = [];
	for (const bucket of BUCKETS) {
		const candidates = (grouped.get(bucket) ?? []).slice().sort((left, right) => left.question_id.localeCompare(right.question_id));
		for (const instance of spread(candidates, per)) {
			questions.push({
				id: instance.question_id,
				ability: bucket,
				history: historyOf(instance),
				question: instance.question,
				answer: instance.answer,
			});
		}
	}

	const turns = questions.map((question) => question.history.length);
	const chars = questions.map((question) => question.history.reduce((sum, message) => sum + message.content.length, 0));
	const average = (values: readonly number[]): number => Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));

	const fixture = {
		name: `longmemeval · ${per}×${BUCKETS.length} · ${source.split("/").pop() ?? source}`,
		questions,
	};
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, `${JSON.stringify(fixture, null, "\t")}\n`);

	console.log(`[lme] ${all.length} instances → ${questions.length} questions`);
	for (const bucket of BUCKETS) {
		const picked = questions.filter((question) => question.ability === bucket);
		const pool = grouped.get(bucket)?.length ?? 0;
		console.log(`  ${bucket.padEnd(16)} ${String(picked.length).padStart(3)}/${pool} in pool`);
	}
	console.log(`[lme] history: avg ${average(turns)} turns / ${average(chars)} chars ≈ ${Math.round(average(chars) / 4)} tokens`);
	console.log(`[lme] wrote ${target}`);
}

await main();
