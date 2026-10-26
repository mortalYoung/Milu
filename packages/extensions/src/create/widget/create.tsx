import { Kbd, KbdGroup, type DialogProps } from "@milu/window/api";
import { useState } from "react";

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const FIELD =
	"h-10 w-full rounded-md border border-line bg-surface px-3 py-2 font-sans text-[14px] text-ink transition-colors duration-[120ms] placeholder:text-muted focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 aria-invalid:border-signal";
const BUTTON =
	"inline-flex h-9 cursor-pointer items-center justify-center rounded-lg px-3 font-sans text-[12px] font-medium whitespace-nowrap transition-[background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-ink focus-visible:[outline-offset:2px] active:scale-[0.97]";

export function CreateSessionDialog(props: DialogProps) {
	const [name, setName] = useState("");
	const [persona, setPersona] = useState("");
	const [workspace, setWorkspace] = useState("");
	const [error, setError] = useState<string | null>(null);

	const typed = name.trim();
	const taken = props.host.sessions.store.getState().rows.map((row) => row.name.toLowerCase());
	const dirty = name !== "" || persona !== "" || workspace !== "";

	const choose = async (): Promise<void> => {
		const picked = await props.host.picker.pick(workspace || undefined);
		if (picked) setWorkspace(picked);
	};

	const submit = () => {
		if (!typed) {
			setError("Name is required");
			return;
		}
		if (!NAME_PATTERN.test(typed)) {
			setError("Name must be alphanumeric, '_' or '-', up to 64 characters");
			return;
		}
		if (taken.includes(typed.toLowerCase())) {
			setError(`"${typed}" already exists · choose a different name`);
			return;
		}
		props.close({
			name: typed,
			...(persona.trim() ? { persona: persona.trim() } : {}),
			...(workspace.trim() ? { workspace: workspace.trim() } : {}),
		});
	};

	return (
		<form
			className="flex w-[600px] max-w-full flex-col"
			autoComplete="off"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
				if (!event.metaKey && !event.ctrlKey) return;
				event.preventDefault();
				submit();
			}}
		>
			<header className="border-b border-line px-5 py-4">
				<h2 className="m-0 font-serif text-[18px] font-semibold tracking-[-0.01em] text-ink">Create</h2>
				<p className="mt-1 mb-0 text-[12px] text-muted">Only the name is required.</p>
			</header>

			<div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3.5 px-5 py-4">
				<aside className="border-r border-line pr-3.5">
					<span className="grid size-11 place-items-center rounded-full bg-hover font-serif text-[18px] font-semibold leading-none text-ink">
						{(typed || "?")[0]?.toUpperCase()}
					</span>
					<p className={`mt-2 mb-0 truncate text-[14px] font-medium ${typed ? "text-ink" : "text-muted"}`}>{typed || "Untitled"}</p>
				</aside>

				<div className="grid min-w-0 content-start gap-3">
					<div className="flex flex-col gap-1">
						<label htmlFor="create-name" className="text-[12px] leading-none font-medium tracking-[0.6px] text-muted uppercase">
							Name<span className="ml-1.5 font-mono text-[10px] font-normal tracking-normal normal-case">required</span>
						</label>
						<input
							id="create-name"
							autoFocus
							value={name}
							aria-invalid={error ? true : undefined}
							aria-describedby={error ? "create-name-error" : undefined}
							placeholder="ada"
							className={FIELD}
							onChange={(event) => {
								setName(event.currentTarget.value);
								setError(null);
							}}
						/>
						{error ? (
							<p id="create-name-error" role="alert" className="mt-0.5 mb-0 text-[12px] text-signal">
								{error}
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-1">
						<label htmlFor="create-persona" className="text-[12px] leading-none font-medium tracking-[0.6px] text-muted uppercase">
							Persona
						</label>
						<textarea
							id="create-persona"
							rows={3}
							value={persona}
							spellCheck={false}
							placeholder={"## Persona\n\nHow should this partner work and speak? Markdown supported…"}
							className={`${FIELD} h-auto min-h-0 resize-none`}
							onChange={(event) => setPersona(event.currentTarget.value)}
						/>
					</div>

					<div className="flex flex-col gap-1">
						<label htmlFor="create-workspace" className="text-[12px] leading-none font-medium tracking-[0.6px] text-muted uppercase">
							Workspace
						</label>
						<input
							id="create-workspace"
							readOnly
							value={workspace}
							spellCheck={false}
							aria-label="Workspace Directory"
							placeholder="Choose a directory…"
							className={`${FIELD} cursor-pointer select-none`}
							onClick={() => void choose()}
							onKeyDown={(event) => {
								if (event.key !== "Enter" && event.key !== " ") return;
								event.preventDefault();
								void choose();
							}}
						/>
					</div>
				</div>
			</div>

			<footer className="flex items-center gap-2 border-t border-line px-5 py-3.5">
				<KbdGroup>
					<Kbd>⌘</Kbd>
					<Kbd>↵</Kbd>
				</KbdGroup>
				<span className="flex-1" />
				<button type="button" className={`${BUTTON} border-0 bg-transparent text-ink hover:bg-hover`} onClick={() => props.close(null)}>
					{dirty ? "Discard" : "Cancel"}
				</button>
				<button type="submit" className={`${BUTTON} border-0 bg-ink text-canvas hover:bg-[color-mix(in_srgb,var(--ink)_90%,transparent)]`}>
					Create
				</button>
			</footer>
		</form>
	);
}

export default CreateSessionDialog;
