import { createContext, type JSX, useContext } from "solid-js";
import type { createTrajectory } from "./trajectory";

export type Trajectory = ReturnType<typeof createTrajectory>;

const TrajectoryContext = createContext<Trajectory | undefined>(undefined);

export function TrajectoryProvider(props: { value: Trajectory; children?: JSX.Element }) {
	return <TrajectoryContext.Provider value={props.value}>{props.children}</TrajectoryContext.Provider>;
}

export function useTrajectory(): Trajectory {
	const ctx = useContext(TrajectoryContext);
	if (!ctx) throw new Error("useTrajectory must be used within TrajectoryProvider");
	return ctx;
}
