import { createSignal } from "solid-js";
import type { SandboxMode, ThinkingLevel } from "../../shared/rpc";
import type { RPC } from "./rpc";

/** Per-partner agent runtime status: who is writing (agent streaming or command running; each partner runs its own agent), plus the selected chat's workspace/sandbox/model. */
export function createAgentStatus(rpc: RPC, getSelectedName: () => string | null) {
	const [writing, setWriting] = createSignal<Record<string, boolean>>({});
	const [workspacePath, setWorkspacePath] = createSignal<string | null>(null);
	const [storagePath, setStoragePath] = createSignal<string | null>(null);
	const [sandboxMode, setSandboxMode] = createSignal<SandboxMode>("workspace-write");
	const [model, setModel] = createSignal<{ provider: string; modelId?: string } | null>(null);
	const [thinkingLevel, setThinkingLevel] = createSignal<ThinkingLevel>("high");
	const [thinkingLevels, setThinkingLevels] = createSignal<ThinkingLevel[]>([]);
	const [models, setModels] = createSignal<{ provider: string; models: { id: string; name: string }[] }[]>([]);
	// Follow-up messages queued behind the selected partner's run (view-side counter; drained per turn)
	const [queued, setQueued] = createSignal(0);

	// The selected chat is busy when its own partner is writing
	const isBusyForSelected = () => (getSelectedName() ? (writing()[getSelectedName()!] ?? false) : false);
	// Per-partner writing state for the list rows: the run's owner shows dots even when not selected
	const workingFor = (name: string) => writing()[name] ?? false;

	// Calibrate: get_status is authoritative; covers lost/late push events (e.g. the startup race where mount lags the first turn)
	function calibrate() {
		void rpc.request.get_status({}).then((s) => {
			setWriting(Object.fromEntries(s.partners.map((p) => [p.name, p.writing])));
			setWorkspacePath(s.workspace_path);
			setStoragePath(s.storage_path);
			setSandboxMode(s.sandbox_mode);
			setModel(s.model);
			setThinkingLevel(s.thinking_level);
			setThinkingLevels(s.thinking_levels);
			setModels(s.models);
		});
	}

	async function onSetSandboxMode(mode: SandboxMode) {
		const res = await rpc.request.set_sandbox_mode({ mode });
		if (res.ok) setSandboxMode(mode);
	}

	async function onSetModel(next: { provider: string; modelId?: string }) {
		const res = await rpc.request.set_partner_model({ model: next });
		if (res.ok) {
			setModel(next);
			calibrate();
		}
	}

	async function onSetThinkingLevel(level: ThinkingLevel) {
		const res = await rpc.request.set_thinking_level({ level });
		if (res.ok) setThinkingLevel(level);
	}

	/** A turn started for `partner`: it is writing now, and one queued follow-up drains when the run owns the selected chat. Returns whether a follow-up drained. */
	function beginTurn(partner: string): boolean {
		setWriting((m) => ({ ...m, [partner]: true }));
		const drained = queued() > 0 && partner === getSelectedName();
		if (drained) setQueued((q) => q - 1);
		return drained;
	}

	/** A turn ended for `partner`: it stops writing and the queue resets (calibrate re-syncs from get_status). */
	function endTurn(partner: string) {
		setWriting((m) => ({ ...m, [partner]: false }));
		setQueued(0);
	}

	return {
		isBusyForSelected,
		workingFor,
		workspacePath,
		storagePath,
		sandboxMode,
		model,
		thinkingLevel,
		thinkingLevels,
		models,
		calibrate,
		onSetSandboxMode,
		onSetModel,
		onSetThinkingLevel,
		beginTurn,
		endTurn,
		queueFollowUp: () => setQueued((q) => q + 1),
	};
}
