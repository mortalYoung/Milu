import type { AgentTool, AgentToolResult, AgentToolUpdateCallback, ExecutionEnv } from "@earendil-works/pi-agent-core";
import { createServiceId, type Disposable, type Service } from "@milu/di";

import type { Session } from "../session/session.ts";
import type { ConfigService } from "./config.ts";
import type { ExecutionService } from "./execution.ts";
import { expandHome } from "./settings.ts";

export interface ToolContext {
	readonly session: Session;
	readonly env: ExecutionEnv;
}

export type Tool = Omit<AgentTool, "execute"> & {
	execute(toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<any>): Promise<AgentToolResult<any>>;
};

export type ToolFactory = (context: ToolContext) => Tool | null;

export class ToolService implements Service {
	private readonly _factories: ToolFactory[] = [];

	constructor(
		private readonly _configService: ConfigService,
		private readonly _executionService: ExecutionService,
	) {}

	register(factory: ToolFactory): Disposable {
		this._factories.push(factory);
		return {
			dispose: () => {
				const at = this._factories.indexOf(factory);
				if (at >= 0) this._factories.splice(at, 1);
			},
		};
	}

	async tools(session: Session): Promise<readonly Tool[]> {
		const workspace = await session.workspace();
		const context: ToolContext = {
			session,
			env: this._executionService.env(workspace ? expandHome(workspace.path) : this._configService.workspace),
		};

		const tools: Tool[] = [];
		const names = new Set<string>();
		for (const create of this._factories) {
			const tool = create(context);
			if (!tool) continue;
			if (names.has(tool.name)) throw new Error(`tool "${tool.name}" is already registered`);
			names.add(tool.name);
			tools.push(tool);
		}
		return tools;
	}

	dispose(): void {
		this._factories.length = 0;
	}
}

export const ToolServiceId = createServiceId<ToolService>("ToolService");
