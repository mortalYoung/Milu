import { createResource } from "solid-js";
import type { CommandDescriptor, CommandExecution } from "../../shared/rpc";
import { useToast } from "./contexts/toast-context";
import type { RPC } from "./rpc";

export function filterCommands(commands: CommandDescriptor[], query: string): CommandDescriptor[] {
	const q = query.trim().toLowerCase();
	if (!q) return commands;
	const rank = (command: CommandDescriptor): number => {
		const name = command.name.toLowerCase();
		if (name.startsWith(q)) return 0;
		if (name.includes(q)) return 1;
		return command.description
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.some((word) => word.startsWith(q))
			? 2
			: -1;
	};
	return commands
		.map((command) => ({ command, at: rank(command) }))
		.filter((hit) => hit.at >= 0)
		.sort((a, b) => a.at - b.at || a.command.name.localeCompare(b.command.name))
		.map((hit) => hit.command);
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
