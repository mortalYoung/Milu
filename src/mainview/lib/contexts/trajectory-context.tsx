import { createContext, type ReactNode, useContext } from "react";
import type { createTrajectory } from "../trajectory";

export type Trajectory = ReturnType<typeof createTrajectory>;

const TrajectoryContext = createContext<Trajectory | undefined>(undefined);

export function TrajectoryProvider(props: { value: Trajectory; children?: ReactNode }) {
	return <TrajectoryContext.Provider value={props.value}>{props.children}</TrajectoryContext.Provider>;
}

export function useTrajectory(): Trajectory {
	const ctx = useContext(TrajectoryContext);
	if (!ctx) throw new Error("useTrajectory must be used within TrajectoryProvider");
	return ctx;
}
