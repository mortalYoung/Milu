import { createResource } from "solid-js";
import { createStore } from "solid-js/store";
import type { SandboxMode, ThinkingLevel } from "../../shared/rpc";
import { useSession } from "./contexts/session-context";
import type { RPC } from "./rpc";

const CALIBRATE_DEBOUNCE_MS = 400;

const EMPTY_STATUS = {
	partner: null,
	workspace_path: null,
	is_git_repo: false,
	change_count: 0,
	worktree_count: 0,
	storage_path: null,
	sandbox_mode: "workspace-write" as SandboxMode,
	model: null,
	thinking_level: "high" as ThinkingLevel,
	thinking_levels: [] as ThinkingLevel[],
	models: [] as { provider: string; models: { id: string; name: string }[] }[],
};

export function createAgentStatus(rpc: RPC) {
	const { data } = useSession();
	const [writing, setWriting] = createStore<Record<string, boolean>>({});
	const [starts, setStarts] = createStore<Record<string, number>>({});
	const [snapshot, { refetch }] = createResource(
		() => data.selected,
		async (name) => (name ? { ...(await rpc.request.get_status({ name })), partner: name } : EMPTY_STATUS),
		{ initialValue: EMPTY_STATUS },
	);
	/**
	 * A refetch keeps the previous value, so for a beat after a partner switch the status in hand still
	 * describes the partner we left — its workspace, its repo, its change count. Anything that *acts* on
	 * the status (closing a dock, for one) has to ask whether it is looking at the right partner's.
	 */
	const settled = () => snapshot().partner === data.selected;
	const status = () => (data.selected ? snapshot() : EMPTY_STATUS);

	let workspaceKey: { partner: string | null; path: string | null } | null = null;
	let calibrateTimer: ReturnType<typeof setTimeout> | undefined;

	rpc.addMessageListener("context_changed", ({ workspace }) => {
		const key = { partner: data.selected, path: workspace ?? null };
		if (workspaceKey && workspaceKey.partner === key.partner && workspaceKey.path === key.path) return;
		workspaceKey = key;
		calibrate();
	});

	rpc.addMessageListener("agent_message", () => calibrate());
	rpc.addMessageListener("shell_update", () => calibrate());

	const partnerWriting = (name: string) => data.partners.find((p) => p.name === name)?.writing ?? false;

	const isBusyForSelected = () => (data.selected ? (writing[data.selected] ?? partnerWriting(data.selected)) : false);
	const workingFor = (name: string) => writing[name] ?? partnerWriting(name);

	function calibrate() {
		if (!data.selected) return;
		clearTimeout(calibrateTimer);
		calibrateTimer = setTimeout(() => void refetch(), CALIBRATE_DEBOUNCE_MS);
	}

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
		setWriting({ [partner]: true });
		setStarts({ [partner]: Date.now() });
	}

	function endTurn(partner: string) {
		setWriting({ [partner]: false });
		setStarts((current) => {
			if (!(partner in current)) return current;
			const next = { ...current };
			delete next[partner];
			return next;
		});
	}

	const sinceFor = (partner: string) => starts[partner] ?? null;

	function releaseTurn(partner: string) {
		setWriting((current) => {
			if (!(partner in current)) return current;
			const next = { ...current };
			delete next[partner];
			return next;
		});
		setStarts((current) => {
			if (!(partner in current)) return current;
			const next = { ...current };
			delete next[partner];
			return next;
		});
	}

	return {
		data: status,
		settled,
		isBusyForSelected,
		workingFor,
		sinceFor,
		calibrate,
		mutateSandboxMode,
		mutateModel,
		mutateThinkingLevel,
		beginTurn,
		endTurn,
		releaseTurn,
	};
}
