import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { foldSliceItems } from "../../shared/slice";
import { convertToLlm, MODELS, resolveModel } from "./agent-config";

export interface BtwMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: number;
}

export interface BtwThread {
	id: string;
	anchorEntryId: string;
	createdAt: number;
	updatedAt: number;
	messages: BtwMessage[];
}

const FILE_NAME = "side-threads.jsonl";

function filePath(dir: string): string {
	return join(dir, FILE_NAME);
}

export async function readBtwThreads(dir: string): Promise<BtwThread[]> {
	try {
		const raw = await readFile(filePath(dir), "utf8");
		return raw
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as BtwThread);
	} catch {
		return [];
	}
}

export async function writeBtwThreads(dir: string, threads: BtwThread[]): Promise<void> {
	await mkdir(dir, { recursive: true });
	const body = threads.map((t) => JSON.stringify(t)).join("\n") + (threads.length > 0 ? "\n" : "");
	await writeFile(filePath(dir), body, "utf8");
}

export function btwThreadsForAnchor(threads: BtwThread[], anchorEntryId: string): BtwThread[] {
	return threads.filter((t) => t.anchorEntryId === anchorEntryId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getBtwThread(dir: string, threadId: string): Promise<BtwThread | null> {
	const threads = await readBtwThreads(dir);
	return threads.find((t) => t.id === threadId) ?? null;
}

export async function appendBtwMessages(dir: string, threadId: string, messages: BtwMessage[]): Promise<BtwThread> {
	const threads = await readBtwThreads(dir);
	const idx = threads.findIndex((t) => t.id === threadId);
	if (idx < 0) throw new Error("btw thread not found");
	threads[idx].messages.push(...messages);
	threads[idx].updatedAt = Date.now();
	await writeBtwThreads(dir, threads);
	return threads[idx];
}

export function btwBaseContext(entries: Entry[], anchorEntryId: string): AgentMessage[] {
	const index = entries.findIndex((e) => e.id === anchorEntryId);
	const slice = index >= 0 ? entries.slice(0, index + 1) : entries;
	return foldSliceItems(slice, { keepDangling: true }).map((item) => item.message);
}

export function textFromAssistant(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => {
			const block = b as { type?: unknown; text?: unknown } | null;
			return block && block.type === "text" && typeof block.text === "string" ? block.text : "";
		})
		.join("\n")
		.trim();
}

export async function askBtwOnce(systemPrompt: string, contextMessages: AgentMessage[], question: string): Promise<string> {
	const model = resolveModel();
	const now = Date.now();
	const reminder: AgentMessage = {
		role: "user",
		content:
			"<system_reminder>You are in btw side-question mode. This is a side discussion about the current conversation. You have no tools, skills, or commands available; do not attempt to call them or emit tool call syntax. Use only the provided context and answer in plain text.</system_reminder>",
		timestamp: now,
	};
	const messages = convertToLlm([...contextMessages, reminder, { role: "user", content: question, timestamp: now }]);
	const response = await MODELS.completeSimple(model, { systemPrompt, messages }, {});
	console.log("response:", JSON.stringify(response));
	const text = textFromAssistant(response.content);
	if (!text) throw new Error("btw model returned no text");
	return text;
}

function historyToMessages(thread: BtwThread): AgentMessage[] {
	return thread.messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.createdAt }) as AgentMessage);
}

export async function createBtwThread(dir: string, anchorEntryId: string, question: string, systemPrompt: string, baseContext: AgentMessage[]): Promise<BtwThread> {
	const now = Date.now();
	const thread: BtwThread = { id: randomUUID(), anchorEntryId, createdAt: now, updatedAt: now, messages: [] };
	const threads = await readBtwThreads(dir);
	threads.push(thread);
	await writeBtwThreads(dir, threads);
	return askBtwThread(dir, thread.id, question, systemPrompt, baseContext);
}

export async function askBtwThread(dir: string, threadId: string, question: string, systemPrompt: string, baseContext: AgentMessage[]): Promise<BtwThread> {
	const thread = await getBtwThread(dir, threadId);
	if (!thread) throw new Error("btw thread not found");
	const history = historyToMessages(thread);
	const answer = await askBtwOnce(systemPrompt, [...baseContext, ...history], question);
	const now = Date.now();
	await appendBtwMessages(dir, threadId, [
		{ id: randomUUID(), role: "user", content: question, createdAt: now },
		{ id: randomUUID(), role: "assistant", content: answer, createdAt: now },
	]);
	return (await getBtwThread(dir, threadId))!;
}
