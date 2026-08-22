import { createSignal } from "solid-js";
import type { SandboxMode } from "../../shared/rpc";
import type { RPC } from "./rpc";

/** Per-partner agent runtime status: who is streaming (each partner runs its own agent), plus the selected chat's workspace/sandbox. */
export function createAgentStatus(rpc: RPC, getSelectedName: () => string | null) {
	const [streaming, setStreaming] = createSignal<Record<string, boolean>>({});
	const [workspacePath, setWorkspacePath] = createSignal<string | null>(null);
	const [sandboxMode, setSandboxMode] = createSignal<SandboxMode>("workspace-write");
	// Follow-up messages queued behind the selected partner's run (view-side counter; drained per turn)
	const [queued, setQueued] = createSignal(0);

	// The selected chat is busy when its own agent is streaming
	const isBusyForSelected = () => (getSelectedName() ? (streaming()[getSelectedName()!] ?? false) : false);
	// Per-partner writing state for the list rows: the run's owner shows dots even when not selected
	const workingFor = (name: string) => streaming()[name] ?? false;

	// Calibrate: get_status is authoritative; covers lost/late push events (e.g. the startup race where mount lags the first turn)
	function calibrate() {
		void rpc.request.get_status({}).then((s) => {
			setStreaming(Object.fromEntries(s.partners.map((p) => [p.name, p.streaming])));
			setWorkspacePath(s.workspace_path);
			setSandboxMode(s.sandbox_mode);
		});
	}

	async function onSetSandboxMode(mode: SandboxMode) {
		const res = await rpc.request.set_sandbox_mode({ mode });
		if (res.ok) setSandboxMode(mode);
	}

	/** A turn started for `partner`: it is streaming now, and one queued follow-up drains when the run owns the selected chat. Returns whether a follow-up drained. */
	function beginTurn(partner: string): boolean {
		setStreaming((m) => ({ ...m, [partner]: true }));
		const drained = queued() > 0 && partner === getSelectedName();
		if (drained) setQueued((q) => q - 1);
		return drained;
	}

	/** A turn ended for `partner`: it stops streaming and the queue resets (calibrate re-syncs from get_status). */
	function endTurn(partner: string) {
		setStreaming((m) => ({ ...m, [partner]: false }));
		setQueued(0);
	}

	return {
		isBusyForSelected,
		workingFor,
		workspacePath,
		sandboxMode,
		calibrate,
		onSetSandboxMode,
		beginTurn,
		endTurn,
		queueFollowUp: () => setQueued((q) => q + 1),
	};
}
