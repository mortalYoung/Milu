import { chmod, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
	type ExecutionEnv,
	EVENTS,
	expandHome,
	type Session,
	type SettingsPoint,
	type SettingsService,
	type ToolCall,
	type ToolNext,
	type ToolResult,
	type ToolService,
} from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { seatbeltBackend } from "../backends/seatbelt.ts";
import { movesToTrash } from "../delete-verbs.ts";
import { dwsEnv } from "../dws.ts";
import { createEnv } from "../env.ts";
import { type EscalationDecision, type EscalationRequest, escalationLog, type EscalationState, readDecisions } from "../escalations.ts";
import { isStrictlyWider } from "../modes.ts";
import { packageManagerEnv, PM_CACHE } from "../pm.ts";
import { resolveExemptRoot } from "../roots.ts";
import type { ConfinedArgv, PermissionPolicy, SandboxBackend, SandboxMode } from "../types.ts";

const DELETE_DEFAULTS = { strict: true };
function isMode(value: unknown): value is SandboxMode {
	return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

const SANDBOX_KEY = "defaultSandboxMode";
const SANDBOX_DEFAULT: SandboxMode = "workspace-write";

const EXEMPT_KEY = "sandboxExemptRoot";
const EXEMPT_DEFAULT = "~/Milu/Permissions";

const BACKENDS: readonly SandboxBackend[] = process.platform === "darwin" ? [seatbeltBackend] : [];

const ESCALATION_UNAVAILABLE_TEXT = "[sandbox: escalation unavailable — no confining backend on this platform]";

const STOP_TEXT = "[sandbox: escalation requested — the run stops until the user answers]";

export type EscalationCode = "sandbox_unavailable" | "escalation_not_wider" | "escalation_no_justification";

export type EscalationOutcome = { readonly requested: true; readonly escalationId: string } | { readonly requested: false; readonly code: EscalationCode; readonly reason: string };

export class PermissionService implements Service {
	private _backend: SandboxBackend | null | undefined;
	private _delete: SettingsPoint<{ strict: boolean }> | null = null;
	private _sandbox: SettingsPoint<SandboxMode> | null = null;
	private _exempt: SettingsPoint<string> | null = null;
	private readonly _modes = new Map<string, SandboxMode>();
	private readonly _nonce = Date.now().toString(36);
	private _seq = 0;
	private readonly _failures = new Map<string, string[]>();

	constructor(
		private readonly _settingsService: SettingsService,
		private readonly _toolService: ToolService,
	) {}

	initialize(): void {
		this._delete = this._settingsService.declare({ key: "delete", defaults: DELETE_DEFAULTS });
		this._sandbox = this._settingsService.declare({ key: SANDBOX_KEY, defaults: SANDBOX_DEFAULT });
		this._exempt = this._settingsService.declare({ key: EXEMPT_KEY, defaults: EXEMPT_DEFAULT });
	}

	async mode(session: Session): Promise<SandboxMode> {
		const cached = this._modes.get(session.name);
		if (cached) return cached;
		const saved = await session.sandbox();
		const mode = isMode(saved) ? saved : (this._sandbox?.get() ?? SANDBOX_DEFAULT);
		this._modes.set(session.name, mode);
		return mode;
	}

	async setMode(session: Session, mode: SandboxMode): Promise<void> {
		await session.setSandbox(mode);
		this._modes.set(session.name, mode);
	}

	isConfining(): boolean {
		return this._backendOf() !== null;
	}

	trash(): string {
		return join(homedir(), ".Trash");
	}

	async env(session: Session, workspace: string | null, mode?: SandboxMode): Promise<ExecutionEnv> {
		const storage = join(session.root, "storage");
		await mkdir(storage, { recursive: true });
		const saved = await session.sandbox();
		const cache = expandHome(saved.cache ?? PM_CACHE);
		await mkdir(cache, { recursive: true });
		const configured = this._exempt?.get() ?? EXEMPT_DEFAULT;
		if (typeof configured !== "string" || configured.trim() === "") throw new Error(`settings "${EXEMPT_KEY}" must be a non-empty string`);
		const exemptRoot = resolveExemptRoot(expandHome(configured.trim()));
		const dwsRoot = join(exemptRoot, ".dws");
		const dws = dwsEnv(dwsRoot);
		const dwsConfig = dws["DWS_CONFIG_DIR"];
		const dwsKeychain = dws["DWS_KEYCHAIN_DIR"];
		const dwsPerf = dirname(dws["DWS_PERF_REPORT"]);
		await mkdir(dwsConfig, { recursive: true, mode: 0o700 });
		await mkdir(dwsKeychain, { recursive: true, mode: 0o700 });
		await mkdir(dwsPerf, { recursive: true, mode: 0o700 });
		for (const dir of [exemptRoot, dwsRoot, dwsConfig, dwsKeychain, dwsPerf]) await chmod(dir, 0o700);
		const resolved = await realpath(exemptRoot);
		if (resolved !== exemptRoot) throw new Error(`settings "${EXEMPT_KEY}" resolves to ${resolved}; the exemption root must not be a symlink`);
		const policy: PermissionPolicy = {
			mode: mode ?? (await this.mode(session)),
			workspace,
			storage,
			trash: this.trash(),
			write: [...saved.write.map(expandHome), cache, exemptRoot],
			env: { ...packageManagerEnv(cache), ...dws },
		};
		return createEnv(policy, {
			sandboxed: this.isConfining(),
			strictDelete: this._delete ? this._delete.get().strict !== false : true,
			confine: (each, argv) => this._confine(each, argv),
			onExit: (command, exitCode) => {
				if (exitCode === 0) return;
				const failures = this._failures.get(session.name) ?? [];
				failures.push(command);
				this._failures.set(session.name, failures.slice(-5));
			},
		});
	}

	async intercept(call: ToolCall, _env: ExecutionEnv, next: ToolNext): Promise<ToolResult> {
		if (call.name === "rm") {
			const refusal = await this._deleteGate(call);
			if (refusal) return refusal;
		}

		const { sandbox_mode: requested, justification } = (call.params ?? {}) as { sandbox_mode?: SandboxMode; justification?: string };

		if (!requested) return next(call, await this.env(call.session, call.workspace));

		const existing = await this._requestOf(call.session, call.toolCallId);
		if (existing) {
			const decision = await this._decisionOf(call.session, existing.escalationId);
			if (!decision) return stopResult();
			if (!decision.approved) return decision.dropped ? droppedResult(existing) : rejectedResult(existing);
			return next(call, await this.env(call.session, call.workspace, existing.to));
		}

		const outcome = await this._request(call, requested, justification ?? "");
		if (!outcome.requested) {
			return { content: [{ type: "text", text: outcome.reason }], details: { sandbox: { code: outcome.code } } };
		}
		return stopResult();
	}

	async pending(session: Session): Promise<readonly EscalationRequest[]> {
		const { requests, decided } = await escalationLog(session);
		return requests.filter((request) => !decided.has(request.escalationId));
	}

	async settle(session: Session, request: EscalationRequest, decision: EscalationDecision, drive = true): Promise<boolean> {
		const resumed = await session.resume(request.toolCallId, async () => {
			await session.record(EVENTS.escalationDecision, {
				escalationId: request.escalationId,
				approved: decision === "approved",
				...(decision === "dropped" ? { dropped: true } : {}),
				timestamp: Date.now(),
			});
			return this._toolService.run(session, { toolCallId: request.toolCallId, name: request.toolName, params: request.params });
		});
		if (!resumed) await session.record(EVENTS.escalationDecision, { escalationId: request.escalationId, approved: false, dropped: true, timestamp: Date.now() });
		if (resumed && drive) void session.continue();
		return resumed;
	}

	async requestOf(session: Session, escalationId: string): Promise<EscalationRequest | null> {
		return (await this._state(session)).requests.find((request) => request.escalationId === escalationId) ?? null;
	}

	dispose(): void {}

	private _backendOf(): SandboxBackend | null {
		if (this._backend !== undefined) return this._backend;
		const found = BACKENDS.find((backend) => {
			try {
				return backend.probe();
			} catch {
				return false;
			}
		});
		this._backend = found ?? null;
		return this._backend;
	}

	private async _confine(policy: PermissionPolicy, argv: string[]): Promise<ConfinedArgv | null> {
		if (policy.mode === "danger-full-access") return { argv, enforcement: "none", denialSignatures: [], runnerFailureRules: [] };
		const backend = this._backendOf();
		if (!backend) return null;
		return backend.confine(argv, policy);
	}

	private async _deleteGate(call: ToolCall): Promise<ToolResult | null> {
		if (this._delete?.get().strict === false) return null;
		const trash = this.trash();
		const failures = this._failures.get(call.session.name) ?? [];
		if (failures.some((command) => movesToTrash(command, trash))) return null;
		const tried =
			failures.length > 0
				? `Failed bash calls this turn:\n${failures
						.slice(-3)
						.map((command) => `  - ${command.trim().slice(0, 120) || "(unknown)"}`)
						.join("\n")}`
				: "No bash call has failed in this turn.";
		return {
			content: [
				{
					type: "text",
					text: `Refused: strict delete mode wants a failed trash move first. ${tried}\nMove the paths into the trash (\`mv <path> ${trash}/\`) and call rm again only if that fails.`,
				},
			],
			details: { ok: false, code: "no_failed_trash_move", deleted: [], failed: [] },
		};
	}

	private async _state(session: Session): Promise<EscalationState> {
		return escalationLog(session);
	}

	private async _requestOf(session: Session, toolCallId: string): Promise<EscalationRequest | null> {
		const { requests } = await this._state(session);
		return requests.find((request) => request.toolCallId === toolCallId) ?? null;
	}

	private async _decisionOf(session: Session, escalationId: string): Promise<{ approved: boolean; dropped: boolean } | null> {
		return readDecisions(await session.records(EVENTS.escalationDecision)).get(escalationId) ?? null;
	}

	private async _request(call: ToolCall, to: SandboxMode, justification: string): Promise<EscalationOutcome> {
		const from = await this.mode(call.session);
		if (!this.isConfining()) return { requested: false, code: "sandbox_unavailable", reason: ESCALATION_UNAVAILABLE_TEXT };
		if (!isStrictlyWider(from, to)) return { requested: false, code: "escalation_not_wider", reason: `[sandbox: escalation rejected — ${to} is not strictly wider than ${from}]` };
		if (justification.trim() === "") return { requested: false, code: "escalation_no_justification", reason: "[sandbox: escalation rejected — justification is required]" };

		const escalationId = `sbx-${this._nonce}-${++this._seq}`;
		const command = typeof (call.params as { command?: unknown })?.command === "string" ? String((call.params as { command: string }).command) : "";
		await call.session.record(EVENTS.escalationRequest, {
			escalationId,
			toolCallId: call.toolCallId,
			toolName: call.name,
			params: call.params,
			command,
			from,
			to,
			justification,
			timestamp: Date.now(),
		});
		call.session.suspend(call.toolCallId);
		return { requested: true, escalationId };
	}
}

export const IPermissionService = createServiceId<PermissionService>("permission.guard");

function stopResult(): ToolResult {
	return { content: [{ type: "text", text: STOP_TEXT }], details: { sandbox: { escalation: true } }, terminate: true };
}

function rejectedResult(request: EscalationRequest): ToolResult {
	return {
		content: [{ type: "text", text: "[sandbox: escalation rejected — the user declined]" }],
		details: { sandbox: { rejected: true, from: request.from, to: request.to, code: "escalation_rejected" } },
	};
}

function droppedResult(_request: EscalationRequest): ToolResult {
	return { content: [{ type: "text", text: "[sandbox: escalation dropped — the conversation moved on]" }], details: { sandbox: { dropped: true } } };
}
