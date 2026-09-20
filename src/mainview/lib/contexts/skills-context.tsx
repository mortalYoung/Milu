import { createContext, type ReactNode, useContext } from "react";
import type { createSkills } from "../skills";

export type Skills = ReturnType<typeof createSkills>;

const SkillsContext = createContext<Skills | undefined>(undefined);

export function SkillsProvider(props: { value: Skills; children?: ReactNode }) {
	return <SkillsContext.Provider value={props.value}>{props.children}</SkillsContext.Provider>;
}

export function useSkills(): Skills {
	const ctx = useContext(SkillsContext);
	if (!ctx) throw new Error("useSkills must be used within SkillsProvider");
	return ctx;
}
