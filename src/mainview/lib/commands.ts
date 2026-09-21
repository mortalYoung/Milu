import { createStore } from "zustand/vanilla";
import type { CommandDescriptor, CommandExecution } from "../../shared/rpc";
import type { RPC } from "./rpc";
import type { Toast } from "./toast";

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

export function createCommandDirectory(rpc: RPC, toast: Toast) {
	const store = createStore<{ commands: CommandDescriptor[] }>()(() => ({ commands: [] }));

	async function refresh() {
		try {
			const { commands } = await rpc.request.commands_list({});
			store.setState({ commands });
		} catch (error) {
			toast.push({ title: "Commands failed to load", body: error instanceof Error ? error.message : String(error) }, "error");
			store.setState({ commands: [] });
		}
	}

	function filter(query: string): CommandDescriptor[] {
		return filterCommands(store.getState().commands, query);
	}

	function find(name: string): CommandDescriptor | undefined {
		return store.getState().commands.find((c) => c.name === name);
	}

	function execute(line: string): Promise<CommandExecution> {
		return rpc.request.commands_execute({ line });
	}

	return { store, refresh, filter, find, execute };
}
