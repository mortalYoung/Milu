import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBackend } from "../packages/bootstrap/src/backend.ts";
import type { AgentMessage, Backend, Session } from "../packages/core/src/index.ts";

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

interface Fixture {
	readonly name: string;
	readonly questions: readonly FixtureQuestion[];
}

type Arm = "b0" | "v1";

interface Options {
	readonly fixture: string;
	readonly arm: Arm;
	readonly limit: number;
	readonly perBucket: number;
	readonly window: number;
	readonly provider: string;
	readonly modelId: string;
	readonly judgeProvider: string;
	readonly judgeModelId: string;
	readonly judge: boolean;
	readonly credentials: string;
	readonly out: string;
	readonly timeoutMs: number;
	readonly keep: boolean;
}

interface Row {
	readonly arm: Arm;
	readonly id: string;
	readonly ability: string;
	readonly ms: number;
	readonly exact: boolean;
	readonly contains: boolean | null;
	readonly judge?: "yes" | "no" | "error";
	readonly expected: string;
	readonly answer: string;
	readonly error?: string;
}

const USAGE = `usage: bun run bench:memory --fixture <file> [--arm b0|v1] [--limit n] [--per-bucket n] [--window n]
       [--model provider/modelId] [--judge provider/modelId] [--no-judge]
       [--credentials file] [--out file] [--timeout ms] [--keep]

  b0   answer with the last --window messages only, memory off              (the "before")
  v1   ingest the whole history into memory, then answer with the same window  (the current system)`;

function options(argv: readonly string[]): Options {
	const read = (flag: string): string | undefined => {
		const index = argv.indexOf(flag);
		return index < 0 ? undefined : argv[index + 1];
	};
	const fixture = read("--fixture");
	if (fixture === undefined) throw new Error(USAGE);
	const arm = read("--arm") ?? "b0";
	if (arm !== "b0" && arm !== "v1") throw new Error(`unknown arm "${arm}"\n\n${USAGE}`);
	const [provider, modelId] = (read("--model") ?? "deepseek/deepseek-flash").split("/");
	const [judgeProvider, judgeModelId] = (read("--judge") ?? read("--model") ?? "deepseek/deepseek-flash").split("/");
	const credentials = read("--credentials") ?? process.env["MILU_BENCH_CREDENTIALS"];
	if (credentials === undefined) {
		throw new Error(
			[
				"this bench needs its own credentials file — it never reads the app's ~/.config/Milu/.credentials.yaml.",
				"",
				"  printf 'deepseek: <key>\\n' > ~/partners/Mn/storage/bench.credentials.yaml",
				"  chmod 600 ~/partners/Mn/storage/bench.credentials.yaml",
				"",
				`then pass --credentials <file> or set MILU_BENCH_CREDENTIALS.\n\n${USAGE}`,
			].join("\n"),
		);
	}
	return {
		fixture,
		arm,
		limit: Number(read("--limit") ?? "0"),
		perBucket: Number(read("--per-bucket") ?? "0"),
		window: Number(read("--window") ?? "10"),
		provider: provider ?? "deepseek",
		modelId: modelId ?? "deepseek-flash",
		judgeProvider: judgeProvider ?? "deepseek",
		judgeModelId: judgeModelId ?? "deepseek-flash",
		judge: !argv.includes("--no-judge"),
		credentials,
		out: read("--out") ?? join(tmpdir(), `milu-bench-${Date.now()}.jsonl`),
		timeoutMs: Number(read("--timeout") ?? "180000"),
		keep: argv.includes("--keep"),
	};
}

async function prepare(root: string, opts: Options, model: { provider: string; modelId: string }): Promise<void> {
	await mkdir(join(root, "partners"), { recursive: true });
	const settings = {
		partner_profile_path: join(root, "partners"),
		memoryEnabled: opts.arm !== "b0",
		memoryPendingRounds: 10000,
		defaultModel: model,
	};
	await writeFile(join(root, "settings.json"), `${JSON.stringify(settings, null, "\t")}\n`);
	await symlink(opts.credentials, join(root, ".credentials.yaml")).catch(() => undefined);
}

function toMessage(message: FixtureMessage): AgentMessage {
	return { role: message.role, content: [{ type: "text", text: message.content }], timestamp: Date.parse(message.at) } as AgentMessage;
}

function textOf(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			const text = (part as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.join("");
}

async function ask(backend: Backend, session: Session, question: string, timeoutMs: number): Promise<string> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const ended = new Promise<{ readonly error?: string }>((resolve) => {
		const subscription = backend.sessions.onLoopEvent(({ session: name, event }) => {
			if (name !== session.name || event.type !== "run_end") return;
			subscription.dispose();
			resolve({ error: (event as { error?: string }).error });
		});
	});
	const timedOut = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	await session.run(question);
	const outcome = await Promise.race([ended, timedOut]);
	if (timer !== undefined) clearTimeout(timer);
	if (outcome === "timeout") throw new Error(`no answer within ${timeoutMs}ms`);
	if (outcome.error !== undefined) throw new Error(outcome.error);
	const messages = session.messages();
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]!;
		if (message.role !== "assistant") continue;
		const text = textOf(message);
		if (text.trim() !== "") return text;
	}
	return "";
}

function normalize(value: unknown): string {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[\s"'`.,;:!?()[\]{}，。、；：！？“”‘’（）【】《》]+/g, "")
		.trim();
}

function score(question: FixtureQuestion, answer: string): Pick<Row, "exact" | "contains"> {
	const expected = normalize(question.answer);
	const got = normalize(answer);
	if (expected === "") return { exact: false, contains: null };
	return { exact: got === expected, contains: expected.length <= 40 ? got.includes(expected) : null };
}

function judgePrompt(question: FixtureQuestion, answer: string): string {
	return [
		"You grade one answer against a gold answer. Reply with exactly one word: yes or no.",
		"",
		`Question: ${question.question}`,
		`Gold answer: ${question.answer}`,
		`Answer to grade: ${answer}`,
		"",
		"Say yes when the answer states the same fact as the gold answer, even if worded differently or with extra detail. Say no when the fact is missing, wrong, refused, or contradicted.",
	].join("\n");
}

interface Judge {
	verdict(question: FixtureQuestion, answer: string): Promise<"yes" | "no" | "error">;
	close(): Promise<void>;
}

async function startJudge(opts: Options): Promise<Judge | null> {
	if (!opts.judge) return null;
	const root = await mkdtemp(join(tmpdir(), "milu-bench-judge-"));
	await prepare(root, { ...opts, arm: "b0" }, { provider: opts.judgeProvider, modelId: opts.judgeModelId });
	const backend = await createBackend({ root, workspace: root });
	let count = 0;
	return {
		async verdict(question, answer) {
			const session = backend.sessions.get(`judge-${count++}`);
			try {
				const text = await ask(backend, session, judgePrompt(question, answer), opts.timeoutMs);
				return /\byes\b/i.test(text.slice(0, 40)) ? "yes" : "no";
			} catch {
				return "error";
			}
		},
		async close() {
			await backend.close();
			if (!opts.keep) await rm(root, { recursive: true, force: true });
		},
	};
}

async function dropLogs(root: string): Promise<void> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === ".memory") continue;
		const dir = join(root, entry.name);
		const files = await readdir(dir).catch(() => [] as string[]);
		if (!files.some((file) => file.endsWith(".jsonl"))) continue;
		await rm(dir, { recursive: true, force: true });
	}
}

async function runQuestion(opts: Options, question: FixtureQuestion, judge: Judge | null): Promise<Row> {
	const root = await mkdtemp(join(tmpdir(), "milu-bench-"));
	const startedAt = Date.now();
	try {
		await prepare(root, opts, { provider: opts.provider, modelId: opts.modelId });
		const backend = await createBackend({ root, workspace: root });
		try {
			const name = `bench-${question.id}`;
			const windowed = opts.window > 0 ? question.history.slice(-opts.window) : question.history;
			let session = backend.sessions.get(name);
			if (opts.arm === "v1") {
				await session.replay(question.history.map(toMessage));
				for (const op of ["organize", "sops", "persona"]) await backend.actions.run("memory.run", { session, args: op });
				await backend.sessions.close(name);
				await dropLogs(session.root);
				session = backend.sessions.get(name);
			}
			await session.replay(windowed.map(toMessage));
			const answer = await ask(backend, session, question.question, opts.timeoutMs);
			return {
				arm: opts.arm,
				id: question.id,
				ability: question.ability,
				ms: Date.now() - startedAt,
				...score(question, answer),
				...(judge === null ? {} : { judge: await judge.verdict(question, answer) }),
				expected: question.answer,
				answer,
			};
		} finally {
			await backend.close();
		}
	} catch (error) {
		return {
			arm: opts.arm,
			id: question.id,
			ability: question.ability,
			ms: Date.now() - startedAt,
			exact: false,
			contains: null,
			expected: question.answer,
			answer: "",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		if (!opts.keep) await rm(root, { recursive: true, force: true });
	}
}

function firstPerBucket(questions: readonly FixtureQuestion[], take: number): FixtureQuestion[] {
	const seen = new Map<string, number>();
	const out: FixtureQuestion[] = [];
	for (const question of questions) {
		const used = seen.get(question.ability) ?? 0;
		if (used >= take) continue;
		seen.set(question.ability, used + 1);
		out.push(question);
	}
	return out;
}

function percentile(values: readonly number[], at: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * at))]!;
}

function summarize(rows: readonly Row[]): string {
	const asked = rows.filter((row) => row.error === undefined);
	const exact = asked.filter((row) => row.exact).length;
	const contains = asked.filter((row) => row.contains === true).length;
	const errors = rows.length - asked.length;
	const total = asked.length + errors;
	const judged = asked.filter((row) => row.judge !== undefined && row.judge !== "error");
	const passed = judged.filter((row) => row.judge === "yes").length;
	return [
		`arm ${rows[0]?.arm ?? "?"} — ${asked.length}/${total} answered, ${errors} failed`,
		...(judged.length === 0 ? [] : [`  pass     ${passed}/${total} = ${((passed / Math.max(1, total)) * 100).toFixed(1)}%  (timeouts and errors count as wrong)`]),
		...(judged.length === 0 ? [] : [`  answered ${passed}/${judged.length} among answered only`]),
		`  exact    ${exact}/${asked.length}`,
		`  contains ${contains}/${asked.filter((row) => row.contains !== null).length}`,
		`  p50/p95  ${percentile(
			asked.map((row) => row.ms),
			0.5,
		)}ms / ${percentile(
			asked.map((row) => row.ms),
			0.95,
		)}ms`,
	].join("\n");
}

async function main(): Promise<void> {
	const opts = options(process.argv.slice(2));
	const fixture = JSON.parse(await readFile(opts.fixture, "utf8")) as Fixture;
	const limited = opts.limit > 0 ? fixture.questions.slice(0, opts.limit) : fixture.questions;
	const picked = opts.perBucket > 0 ? firstPerBucket(limited, opts.perBucket) : limited;
	if (picked.length === 0) throw new Error(`${opts.fixture} has no questions`);

	console.log(
		`[bench] ${fixture.name} · arm ${opts.arm} · ${picked.length} question(s) · model ${opts.provider}/${opts.modelId} · judge ${opts.judge ? `${opts.judgeProvider}/${opts.judgeModelId}` : "off"}`,
	);
	console.log(`[bench] credentials ← ${opts.credentials}`);
	const judge = await startJudge(opts);
	await writeFile(opts.out, "");
	const rows: Row[] = [];
	try {
		for (const [index, question] of picked.entries()) {
			const row = await runQuestion(opts, question, judge);
			rows.push(row);
			await appendFile(opts.out, `${JSON.stringify(row)}\n`);
			const verdict = row.error === undefined ? (row.judge ?? (row.exact ? "exact" : row.contains ? "contains" : "miss")) : `failed: ${row.error}`;
			console.log(`[${index + 1}/${picked.length}] ${question.id} (${question.ability}) ${verdict} · ${row.ms}ms`);
		}
	} finally {
		await judge?.close();
	}

	console.log(`\n${summarize(rows)}\n[bench] wrote ${opts.out}`);
}

await main();
