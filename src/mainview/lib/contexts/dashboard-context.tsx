import { createContext, type ReactNode, useContext } from "react";
import type { createDashboard } from "../dashboard";

export type Dashboard = ReturnType<typeof createDashboard>;

const DashboardContext = createContext<Dashboard | undefined>(undefined);

export function DashboardProvider(props: { value: Dashboard; children?: ReactNode }) {
	return <DashboardContext.Provider value={props.value}>{props.children}</DashboardContext.Provider>;
}

export function useDashboard(): Dashboard {
	const ctx = useContext(DashboardContext);
	if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
	return ctx;
}
