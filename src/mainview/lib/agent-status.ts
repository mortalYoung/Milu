import { createResource } from "solid-js";
import { createStore } from "solid-js/store";
import type { SandboxMode, ThinkingLevel } from "../../shared/rpc";
import { useSession } from "./contexts/session-context";
import type { RPC } from "./rpc";

const EMPTY_STATUS = {
	workspace_path: null,
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
	const [snapshot, { refetch }] = createResource(
		() => data.selected,
		async (name) => (name ? rpc.request.get_status({ name }) : EMPTY_STATUS),
		{ initialValue: EMPTY_STATUS },
	);

	rpc.addMessageListener("context_changed", () => void refetch());
	rpc.addMessageListener("sandbox_mode_update", () => void refetch());

	const partnerWriting = (name: string) => data.partners.find((p) => p.name === name)?.writing ?? false;

	const isBusyForSelected = () => (data.selected ? (writing[data.selected] ?? partnerWriting(data.selected)) : false);
	const workingFor = (name: string) => writing[name] ?? partnerWriting(name);

	function calibrate() {
		if (data.selected) void refetch();
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
	}

	function endTurn(partner: string) {
		setWriting({ [partner]: false });
	}

	return {
		data: snapshot,
		isBusyForSelected,
		workingFor,
		calibrate,
		mutateSandboxMode,
		mutateModel,
		mutateThinkingLevel,
		beginTurn,
		endTurn,
	};
}
