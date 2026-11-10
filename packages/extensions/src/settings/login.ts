import type { ExtensionContext } from "@milu/core";
import type { AuthChoice, AuthEventText, AuthLoginState, AuthPromptText } from "@milu/protocol";

const LOGIN_MODES: Readonly<Record<string, readonly string[]>> = { anthropic: ["copy_code"] };

const DOMAIN_CHOICES: Readonly<Record<string, readonly AuthChoice[]>> = {
	"github-copilot": [
		{ id: "public", label: "GitHub.com", description: "github.com" },
		{ id: "enterprise", label: "Enterprise", description: "GitHub Enterprise Server" },
	],
};

const SIGN_IN: readonly string[] = ["anthropic", "openai", "github-copilot", "kimi-coding", "xai", "meta"];

export function canSignIn(provider: string): boolean {
	return SIGN_IN.includes(provider);
}

interface Draft {
	provider: string;
	label: string;
	status: AuthLoginState["status"];
	domain: "public" | "enterprise" | null;
	events: AuthEventText[];
	prompt: AuthPromptText | null;
	error?: string;
}

interface Flow {
	readonly draft: Draft;
	readonly abort: AbortController;
	answer: (value: string | null) => void;
}

function snapshot(draft: Draft): AuthLoginState {
	return {
		provider: draft.provider,
		label: draft.label,
		status: draft.status,
		events: [...draft.events],
		prompt: draft.prompt,
		...(draft.error === undefined ? {} : { error: draft.error }),
	};
}

function visiblePrompt(prompt: AuthPromptText, provider: string): AuthPromptText | undefined {
	if (prompt.kind !== "select") return prompt;
	const modes = LOGIN_MODES[provider];
	const options = modes === undefined ? prompt.options : prompt.options.filter((option) => modes.includes(option.id));
	return options.length === 0 ? undefined : { ...prompt, options };
}

export function createLogin(models: ExtensionContext["models"]) {
	let flow: Flow | null = null;

	return {
		state(): AuthLoginState | null {
			return flow === null ? null : snapshot(flow.draft);
		},

		async start(provider: string): Promise<AuthLoginState> {
			if (flow !== null && flow.draft.status === "running") throw new Error(`already signing in to ${flow.draft.provider}`);
			if (!canSignIn(provider)) throw new Error(`${provider} cannot sign in from Settings`);
			const methods = models.authMethods(provider);
			if (methods.oauth === undefined) throw new Error(`${provider} has no sign-in method`);

			const abort = new AbortController();
			const draft: Draft = { provider, label: methods.oauth.name, status: "running", domain: null, events: [], prompt: null };
			const entry: Flow = { draft, abort, answer: () => {} };
			flow = entry;

			void models
				.login(
					provider,
					{
						notify: (event) => {
							draft.events = [...draft.events, event];
						},
						prompt: (prompt) =>
							new Promise<string>((resolve, reject) => {
								const ask = (shown: AuthPromptText, then: (value: string) => void): void => {
									draft.prompt = shown;
									entry.answer = (value) => {
										draft.prompt = null;
										if (value === null) reject(new Error("sign-in cancelled"));
										else then(value);
									};
								};

								const choices = DOMAIN_CHOICES[provider];
								if (choices !== undefined && draft.domain === null && prompt.kind === "text") {
									ask({ kind: "select", message: "GitHub account type", options: choices }, (value) => {
										draft.domain = value === "enterprise" ? "enterprise" : "public";
										if (draft.domain === "public") resolve("");
										else ask(prompt, resolve);
									});
									return;
								}

								const shown = visiblePrompt(prompt, provider);
								if (shown === undefined) {
									reject(new Error("this sign-in step only offers a local callback server"));
									return;
								}
								ask(shown, resolve);
							}),
					},
					{ agentName: "Milu" },
					abort.signal,
				)
				.then(
					() => {
						draft.prompt = null;
						draft.status = "done";
					},
					(error: unknown) => {
						draft.prompt = null;
						draft.status = abort.signal.aborted ? "cancelled" : "failed";
						draft.error = error instanceof Error ? error.message : String(error);
					},
				);

			return snapshot(draft);
		},

		answer(value: string | null): void {
			if (flow === null) return;
			const settle = flow.answer;
			flow.answer = () => {};
			if (value === null) flow.abort.abort();
			settle(value);
		},
	};
}
