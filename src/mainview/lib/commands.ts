import { createResource } from "solid-js";
import type { CommandDescriptor, CommandExecution } from "../../shared/rpc";
import { useToast } from "./contexts/toast-context";
import type { RPC } from "./rpc";

export function filterCommands(commands: CommandDescriptor[], query: string): CommandDescriptor[] {
	const q = query.toLowerCase();
	if (!q) return commands;
	return commands
		.filter((c) => c.name.startsWith(q) || c.name.includes(q))
		.sort((a, b) => {
			const ap = a.name.startsWith(q) ? 0 : 1;
			const bp = b.name.startsWith(q) ? 0 : 1;
			return ap - bp || a.name.localeCompare(b.name);
		});
}

export function createCommandDirectory(rpc: RPC) {
	const toast = useToast();
	const [commands, { refetch }] = createResource(
		async () => {
			try {
				const { commands: list } = await rpc.request.commands_list({});
				return list;
			} catch (error) {
				toast.push({ title: "Commands failed to load", body: error instanceof Error ? error.message : String(error) }, "error");
				return [];
			}
		},
		{ initialValue: [] },
	);

	function filter(query: string): CommandDescriptor[] {
		return filterCommands(commands(), query);
	}

	function find(name: string): CommandDescriptor | undefined {
		return commands().find((c) => c.name === name);
	}

	function execute(line: string): Promise<CommandExecution> {
		return rpc.request.commands_execute({ line });
	}

	return { commands, refresh: refetch, filter, find, execute };
}
