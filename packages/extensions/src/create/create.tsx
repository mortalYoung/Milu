import type { DialogProps } from "@milu/client";
import { useState } from "react";

import "./create.css";

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function CreateSessionDialog(props: DialogProps) {
	const [name, setName] = useState("");
	const [persona, setPersona] = useState("");
	const [workspace, setWorkspace] = useState("");
	const [error, setError] = useState<string | null>(null);

	const typed = name.trim();
	const taken = props.host.sessions.rows.get().map((row) => row.name.toLowerCase());
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
			className="ext-create"
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
			<header className="ext-create-head">
				<h2>Create</h2>
				<p>Only the name is required.</p>
			</header>

			<div className="ext-create-body">
				<aside className="ext-create-side">
					<span className="ext-create-avatar">{(typed || "?")[0]?.toUpperCase()}</span>
					<p className={typed ? "ext-create-preview" : "ext-create-preview empty"}>{typed || "Untitled"}</p>
				</aside>

				<div className="ext-create-fields">
					<div className="ext-create-field">
						<label htmlFor="create-name">
							Name<span className="ext-create-hint">required</span>
						</label>
						<input
							id="create-name"
							autoFocus
							value={name}
							data-invalid={error ? "true" : undefined}
							aria-describedby={error ? "create-name-error" : undefined}
							placeholder="ada"
							onChange={(event) => {
								setName(event.currentTarget.value);
								setError(null);
							}}
						/>
						{error ? (
							<p id="create-name-error" role="alert" className="ext-create-error">
								{error}
							</p>
						) : null}
					</div>

					<div className="ext-create-field">
						<label htmlFor="create-persona">Persona</label>
						<textarea
							id="create-persona"
							rows={3}
							value={persona}
							spellCheck={false}
							placeholder={"## Persona\n\nHow should this partner work and speak? Markdown supported…"}
							onChange={(event) => setPersona(event.currentTarget.value)}
						/>
					</div>

					<div className="ext-create-field">
						<label htmlFor="create-workspace">Workspace</label>
						<input
							id="create-workspace"
							readOnly
							value={workspace}
							spellCheck={false}
							aria-label="Workspace Directory"
							placeholder="Choose a directory…"
							className="pickable"
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

			<footer className="ext-create-foot">
				<span className="ext-create-kbd">
					<kbd>⌘</kbd>
					<kbd>↵</kbd>
				</span>
				{error ? null : <span className="ext-create-spacer" />}
				<button type="button" className="ext-create-ghost" onClick={() => props.close(null)}>
					{dirty ? "Discard" : "Cancel"}
				</button>
				<button type="submit" className="ext-create-primary">
					Create
				</button>
			</footer>
		</form>
	);
}
