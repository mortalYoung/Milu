import { createStore, type StoreApi } from "zustand/vanilla";
import type { SandboxMode, ThinkingLevel } from "../../shared/rpc";
import type { RPC } from "./rpc";
import type { SessionData } from "./session";

const CALIBRATE_DEBOUNCE_MS = 400;

export interface StatusData {
	partner: string | null;
	workspace_path: string | null;
	is_git_repo: boolean;
	change_count: number;
	worktree_count: number;
	storage_path: string | null;
	sandbox_mode: SandboxMode;
	model: { provider: string; modelId?: string } | null;
	thinking_level: ThinkingLevel;
	thinking_levels: ThinkingLevel[];
	models: { provider: string; models: { id: string; name: string }[] }[];
}

export const EMPTY_STATUS: StatusData = {
	partner: null,
	workspace_path: null,
	is_git_repo: false,
	change_count: 0,
	worktree_count: 0,
	storage_path: null,
	sandbox_mode: "workspace-write",
	model: null,
	thinking_level: "high",
	thinking_levels: [],
	models: [],
};

interface AgentStatusState {
	snapshot: StatusData;
	writing: Record<string, boolean>;
	starts: Record<string, number>;
}

function withoutKey<K extends string, V>(record: Record<K, V>, key: K): Record<K, V> {
	if (!(key in record)) return record;
	const next = { ...record };
	delete next[key];
	return next;
}

export function createAgentStatus(rpc: RPC, session: StoreApi<SessionData>) {
	const store = createStore<AgentStatusState>()(() => ({ snapshot: EMPTY_STATUS, writing: {}, starts: {} }));

	let workspaceKey: { partner: string | null; path: string | null } | null = null;
	let calibrateTimer: ReturnType<typeof setTimeout> | undefined;

	const data = () => (session.getState().selected ? store.getState().snapshot : EMPTY_STATUS);
	const settled = () => store.getState().snapshot.partner === session.getState().selected;

	async function refetch() {
		const name = session.getState().selected;
		if (!name) {
			store.setState({ snapshot: EMPTY_STATUS });
			return;
		}
		const res = await rpc.request.get_status({ name });
		store.setState({ snapshot: { ...res, partner: name } });
	}

	function calibrate() {
		if (!session.getState().selected) return;
		clearTimeout(calibrateTimer);
		calibrateTimer = setTimeout(() => void refetch(), CALIBRATE_DEBOUNCE_MS);
	}

	const partnerWriting = (name: string) => session.getState().partners.find((p) => p.name === name)?.writing ?? false;
	const isBusyForSelected = () => {
		const name = session.getState().selected;
		return name ? (store.getState().writing[name] ?? partnerWriting(name)) : false;
	};
	const workingFor = (name: string) => store.getState().writing[name] ?? partnerWriting(name);
	const sinceFor = (name: string) => store.getState().starts[name] ?? null;

	async function mutateSandboxMode(mode: SandboxMode) {
		const res = await rpc.request.set_sandbox_mode({ mode });
		if (res.ok) void refetch();
	}

	async function mutateModel(next: { provider: string; modelId?: string }) {
		const res = await rpc.request.set_partner_model({ model: next });
		if (res.ok) void refetch();
	}

	async function mutateThinkingLevel(level: ThinkingLevel) {
		const res = await rpc.request.set_thinking_level({ level });
		if (res.ok) void refetch();
	}

	function beginTurn(partner: string) {
		store.setState((state) => ({ writing: { ...state.writing, [partner]: true }, starts: { ...state.starts, [partner]: Date.now() } }));
	}

	function endTurn(partner: string) {
		store.setState((state) => ({ writing: { ...state.writing, [partner]: false }, starts: withoutKey(state.starts, partner) }));
	}

	function releaseTurn(partner: string) {
		store.setState((state) => ({ writing: withoutKey(state.writing, partner), starts: withoutKey(state.starts, partner) }));
	}

	function install() {
		session.subscribe((state, previous) => {
			if (state.selected !== previous.selected) void refetch();
		});

		rpc.addMessageListener("context_changed", ({ workspace }) => {
			const key = { partner: session.getState().selected, path: workspace ?? null };
			if (workspaceKey && workspaceKey.partner === key.partner && workspaceKey.path === key.path) return;
			workspaceKey = key;
			calibrate();
		});
		rpc.addMessageListener("agent_message", () => calibrate());
		rpc.addMessageListener("shell_update", () => calibrate());
	}

	return {
		store,
		data,
		settled,
		isBusyForSelected,
		workingFor,
		sinceFor,
		calibrate,
		refetch,
		mutateSandboxMode,
		mutateModel,
		mutateThinkingLevel,
		beginTurn,
		endTurn,
		releaseTurn,
		install,
	};
}
