import { type DialogProps, formatWorkspacePath, listTime } from "@milu/client";
import { Markdown } from "@milu/markdown/react";
import { useState } from "react";

import type { SessionDetails } from "./details.ts";

import "./details.css";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function formatDate(ts: number): string {
	if (!ts) return "unknown";
	const at = new Date(ts);
	return `${MONTHS[at.getMonth()]} ${at.getDate()}`;
}

function Chevron(props: { open: boolean }) {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{props.open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 18 6-6-6-6" />}
		</svg>
	);
}

export function SessionDetailsDialog(props: DialogProps) {
	const [personaOpen, setPersonaOpen] = useState(true);
	const details = props.data as SessionDetails | null;
	if (!details) return null;

	const initial = details.name.trim().charAt(0).toUpperCase() || "?";
	const personaLine = details.persona?.trim().split("\n")[0] || "not set";
	const cards = [
		{ label: "Messages", value: details.messages, hint: "user + assistant" },
		{ label: "Tool calls", value: details.toolCalls, hint: "finished" },
		{ label: "Runs", value: details.runs, hint: "agent loops" },
	];

	return (
		<div className="ext-details">
			<header className="ext-details-head">
				<span className="ext-details-avatar">{initial}</span>
				<div className="ext-details-ident">
					<h2>{details.name}</h2>
					<p>
						{details.path} · created {formatDate(details.createdAt)}
					</p>
				</div>
				{details.running ? <span className="ext-details-writing">● writing</span> : null}
			</header>

			<div className="ext-details-body">
				<div className="ext-details-cards">
					{cards.map((card) => (
						<div className="ext-details-card ext-details-metric" key={card.label}>
							<span className="ext-details-caption">{card.label}</span>
							<span className="ext-details-number">{card.value}</span>
							<span className="ext-details-hint">{card.hint}</span>
						</div>
					))}
				</div>

				<div className="ext-details-grid">
					<div className="ext-details-column">
						<section className="ext-details-card">
							<button type="button" className="ext-details-head-row" aria-expanded={personaOpen} onClick={() => setPersonaOpen(!personaOpen)}>
								<span className="ext-details-caption">Persona</span>
								<span className="ext-details-summary">{personaLine}</span>
								<Chevron open={personaOpen} />
							</button>
							{personaOpen ? (
								<div className="ext-details-persona">
									{details.persona?.trim() ? (
										<Markdown port={props.host.markdown} text={details.persona} />
									) : (
										<>
											<p>No persona on file</p>
											<p className="ext-details-prose">
												A hand-written paragraph in <code>profile.json</code>, read as this session's standing instructions.
											</p>
										</>
									)}
								</div>
							) : null}
						</section>
					</div>

					<div className="ext-details-column">
						<section className="ext-details-card ext-details-pad">
							<p className="ext-details-caption">This Session</p>
							<dl className="ext-details-facts">
								<dt>Entries</dt>
								<dd>{details.entries}</dd>
								<dt>Last activity</dt>
								<dd>{details.lastMessageAt ? listTime(details.lastMessageAt) : "—"}</dd>
								<dt>Opened</dt>
								<dd>{details.startedAt ? formatDate(details.startedAt) : "—"}</dd>
							</dl>
						</section>

						<section className="ext-details-card ext-details-pad">
							<p className="ext-details-caption">Status</p>
							<dl className="ext-details-facts">
								<dt>Workspace</dt>
								<dd title={details.workspace?.path}>{details.workspace ? formatWorkspacePath(details.workspace.path, 34) : "—"}</dd>
								<dt>Storage</dt>
								<dd title={details.storage}>{details.storage}</dd>
								<dt>Fork of</dt>
								<dd>{details.forkedFrom ?? "—"}</dd>
								<dt>Pinned</dt>
								<dd>{details.pinned ? "yes" : "no"}</dd>
							</dl>
						</section>
					</div>
				</div>
			</div>

			<footer className="ext-details-foot">
				<span className="ext-details-kbd">
					<kbd>Esc</kbd>
				</span>
				<span className="ext-details-spacer" />
				<button type="button" className="ext-details-close" onClick={() => props.close(null)}>
					Close
				</button>
			</footer>
		</div>
	);
}
