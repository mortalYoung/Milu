import { Electroview } from "electrobun/view";
import type { AppRPCSchema } from "../../shared/rpc";

// Singleton RPC bridge — module scope so the Electroview is constructed exactly once
// (index.tsx → App → this module is the only import path).
export const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: { requests: {}, messages: {} },
});
new Electroview({ rpc });

export type RPC = typeof rpc;
