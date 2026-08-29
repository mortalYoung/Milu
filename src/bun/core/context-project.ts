import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { ContextSnapshot, RequestTool, ThinkingLevel } from "../../shared/rpc";
import type { Surface } from "../../shared/surface";
import type { SessionStore } from "../persist";
import { contextWindow, resolveModel } from "./agent-config";
import type { Context } from "./context";
import { foldSurface } from "./surface";
import { priceSurface } from "./token-meter";
import { lastTrajectoryUsage } from "./trajectory";

export interface ContextSnapshotDeps {
	session: SessionStore;
	dir: string | null;
	systemPrompt?: string;
	tools?: RequestTool[];
}

export async function projectSnapshot(ctx: Context, deps: ContextSnapshotDeps): Promise<ContextSnapshot> {
	const entries = deps.dir ? await deps.session.rawEntries(deps.dir) : [];
	const surface: Surface = deps.dir ? await deps.session.surface(deps.dir) : { nodes: [], replaceGeneration: 0 };
	let usage = lastTrajectoryUsage(entries);
	let cleared = false;
	if (usage && ctx.contextClearedAt > 0) {
		let lastUsageTime = 0;
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i];
			if (e.type === "message" && e.message.role === "assistant" && e.message.usage) {
				lastUsageTime = e.timestamp ?? 0;
				break;
			}
		}
		cleared = lastUsageTime < ctx.contextClearedAt;
		if (cleared) usage = null;
	}
	const used = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
	const window = contextWindow(ctx.model ?? undefined);
	const hasAgent = deps.systemPrompt !== undefined && deps.tools !== undefined;
	const breakdown = hasAgent && !cleared ? priceSurface(deps.systemPrompt!, deps.tools!, entries, surface) : null;
	let projectedTokens: number | undefined;
	if (hasAgent && usage && breakdown) {
		let lastUsageIdx = -1;
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i];
			if (e.type === "message" && e.message.role === "assistant" && e.message.usage) {
				lastUsageIdx = i;
				break;
			}
		}
		if (lastUsageIdx >= 0) {
			const entriesAtSample = entries.slice(0, lastUsageIdx + 1);
			const surfaceAtSample = foldSurface(entriesAtSample);
			const atSample = priceSurface(deps.systemPrompt!, deps.tools!, entriesAtSample, surfaceAtSample);
			const sampleTotal = atSample.systemTokens + atSample.toolsTokens + atSample.messageTokens;
			const currentTotal = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
			projectedTokens = Math.max(0, used + (currentTotal - sampleTotal));
		}
	}
	const percent = (projectedTokens ?? used) === 0 ? 0 : Math.min(100, Math.round(((projectedTokens ?? used) / window) * 100));
	return {
		used,
		projectedTokens,
		window,
		percent,
		breakdown,
		lastTurn: usage ?? undefined,
		workspace: ctx.workspace_path,
		storage: ctx.storage_path,
		model: ctx.model ? `${ctx.model.provider}/${ctx.model.modelId ?? "default"}` : null,
		sandboxMode: ctx.sandbox_mode,
	};
}

export interface LoopProjection {
	systemPrompt: string;
	model: ReturnType<typeof resolveModel>;
	thinkingLevel: ThinkingLevel;
	tools: AgentTool[];
	messages: AgentMessage[];
}

export function projectLoopContext(ctx: Context, tools: AgentTool[], messages: AgentMessage[]): LoopProjection {
	return {
		systemPrompt: ctx.composeSystemPrompt(),
		model: resolveModel(ctx.model ?? undefined),
		thinkingLevel: ctx.thinkingLevel,
		tools,
		messages,
	};
}
