import { createSignal } from "solid-js";
import type { SkillDescriptor } from "../../shared/rpc";
import type { RPC } from "./rpc";

export function createSkills(rpc: RPC) {
	const [skills, setSkills] = createSignal<SkillDescriptor[]>([]);

	async function refresh(partner: string | null) {
		if (!partner) {
			setSkills([]);
			return;
		}
		const { skills: list } = await rpc.request.skill_list({ partner });
		setSkills(list);
	}

	return { skills, refresh };
}
