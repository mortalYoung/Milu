import { createEffect, createResource } from "solid-js";
import { useSession } from "./contexts/session-context";
import { useToast } from "./contexts/toast-context";
import type { RPC } from "./rpc";

export function createSkills(rpc: RPC) {
	const { data: session } = useSession();
	const toast = useToast();
	const [data, { refetch }] = createResource(
		async () => {
			const partner = session.selected;
			if (!partner) return [];
			try {
				const { skills } = await rpc.request.skill_list({ partner });
				return skills;
			} catch (error) {
				toast.push({ title: "Skills failed to load", body: error instanceof Error ? error.message : String(error) }, "error");
				return [];
			}
		},
		{ initialValue: [] },
	);

	createEffect(() => {
		const partner = session.selected;
		void partner;
		if (partner) refetch();
	});

	rpc.addMessageListener("skills_change", () => refetch());

	function execute(name: string, hint?: string) {
		return rpc.request.skill_execute({ name, ...(hint ? { hint } : {}) });
	}

	function inspect(name: string) {
		return rpc.request.skill_get({ name });
	}

	return {
		data,
		mutate: { refresh: refetch, execute, inspect },
	};
}
