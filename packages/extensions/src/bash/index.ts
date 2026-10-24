import { type ExecutionEnv, type Extension, type ToolCall, IToolService, Type } from "@milu/core";

const DEFAULT_TIMEOUT_SEC = 15;

const MAX_OUTPUT_CHARS = 50 * 1024;

const schema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds for this call; defaults to the bash timeout setting." })),
});

function tail(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
	return { text: `…${text.slice(-MAX_OUTPUT_CHARS)}`, truncated: true };
}

const bashExtension: Extension = {
	id: "bash",
	apiVersion: 1,

	activate(context) {
		const timeout = context.disposables.add(context.settings.declare({ key: "bash", defaults: { timeoutSec: DEFAULT_TIMEOUT_SEC } }));

		context.disposables.add(
			context.get(IToolService).register({
				name: "bash",
				label: "bash",
				description:
					"Execute a bash command. Runs in the working directory when one is set, otherwise in the storage scratch directory. Returns stdout and stderr (last ~50KB, truncated).",
				parameters: schema,
				async run(call: ToolCall, env: ExecutionEnv) {
					const { command, timeout: requested } = call.params as { command: string; timeout?: number };
					if (requested !== undefined && !(Number.isFinite(requested) && requested > 0)) {
						return { content: [{ type: "text", text: `Invalid timeout: ${requested} — pass a positive number of seconds.` }], details: {} };
					}

					const configured = timeout.get().timeoutSec;
					const seconds = requested ?? (configured > 0 ? configured : DEFAULT_TIMEOUT_SEC);
					const result = await env.exec(command, { timeout: seconds, abortSignal: call.signal });
					if (!result.ok) return { content: [{ type: "text", text: result.error.message }], details: { code: result.error.code } };

					const output = tail([result.value.stdout, result.value.stderr].filter((part) => part !== "").join("\n"));
					const text = `${output.text || "(no output)"}${result.value.exitCode === 0 ? "" : `\n\nCommand exited with code ${result.value.exitCode}`}`;
					return { content: [{ type: "text", text }], details: { exitCode: result.value.exitCode, truncated: output.truncated } };
				},
			}),
		);
	},
};

export default bashExtension;
