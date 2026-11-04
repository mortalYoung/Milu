import { SESSIONS } from "./session.js";

const rowsEl = document.getElementById("rows");
const barName = document.getElementById("bar-name");
const barStatus = document.getElementById("bar-status");
const transcript = document.getElementById("transcript");
const inner = document.getElementById("inner");
const replayBtn = document.getElementById("replay");
const replayLabel = replayBtn.querySelector("span");
const models = document.getElementById("models");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let current = SESSIONS[0];
let selected = current.id;
let playing = false;

const icon = (name, cls = "") => `<svg class="ico${cls === "" ? "" : " " + cls}"><use href="#i-${name}"></use></svg>`;

const scrollBottom = () => {
	transcript.scrollTop = transcript.scrollHeight;
};

const money = (cost) => {
	if (typeof cost !== "number") return undefined;
	const digits = cost < 0.01 ? 5 : cost < 1 ? 3 : 2;
	return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits }).format(cost);
};
const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (value) =>
	String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
const span = (ms) => {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds <= 0) return "";
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

function metaRow(time, copyText, cost) {
	const meta = document.createElement("div");
	meta.className = "msg-meta";
	const copy = document.createElement("button");
	copy.className = "msg-copy";
	copy.type = "button";
	copy.setAttribute("aria-label", "Copy");
	copy.dataset.copy = copyText;
	copy.innerHTML = icon("copy");
	meta.append(copy);
	const spend = money(cost);
	if (spend !== undefined) {
		const chip = document.createElement("span");
		chip.className = "spend";
		chip.title = "Priced by the model catalog";
		chip.textContent = spend;
		meta.append(chip);
	}
	const at = document.createElement("time");
	at.className = "msg-at";
	at.textContent = time ?? "14:02";
	meta.append(at);
	return meta;
}

function userBlock(text, time, id) {
	const block = document.createElement("div");
	block.className = "msg msg-user";
	block.dataset.id = id ?? "";
	const bubble = document.createElement("div");
	bubble.className = "msg-user-text";
	bubble.textContent = text;
	block.append(bubble, metaRow(time, text));
	return block;
}

function answerBlock(item) {
	const block = document.createElement("div");
	block.className = "msg msg-agent answer";
	block.dataset.id = item.id ?? "";
	const reply = document.createElement("div");
	reply.className = "reply";
	reply.innerHTML = item.html;
	block.append(reply);
	return block;
}

function answerMeta(item) {
	return metaRow(item.at, item.text, item.cost);
}

async function typeInto(container, html, token) {
	container.innerHTML = html;
	const nodes = [];
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		nodes.push({ node, text: node.textContent ?? "" });
		node.textContent = "";
	}
	const adornments = [...container.querySelectorAll("code, pre, li")];
	for (const element of adornments) element.classList.add("is-empty");
	const total = nodes.reduce((sum, item) => sum + item.text.length, 0);
	let shown = 0;
	while (shown < total) {
		if (token !== runId) return;
		shown = Math.min(total, shown + 5);
		let left = shown;
		for (const item of nodes) {
			item.node.textContent = left > 0 ? item.text.slice(0, Math.min(left, item.text.length)) : "";
			left = Math.max(0, left - item.text.length);
		}
		for (const element of adornments) element.classList.toggle("is-empty", element.textContent.trim() === "");
		scrollBottom();
		await wait(14);
	}
}

function toolIcon(name) {
	const key = String(name).toLowerCase();
	if (/^(bash|sh|shell|run|exec|terminal)/.test(key)) return "terminal";
	if (/^(write|create|save)/.test(key)) return "pencil";
	if (/^(edit|patch|replace|apply)/.test(key)) return "pencil";
	if (/^(read|cat|view|open)/.test(key)) return "file";
	return "wrench";
}

function stepEntry(row, previous) {
	const entry = document.createElement("div");
	entry.className = `step-entry${row.kind === "thinking" ? " is-think" : ""}`;
	const iconName = row.kind === "thinking" ? "brain" : toolIcon(row.name);
	const took = previous === undefined ? "—" : span(row.time - previous.time) || "—";
	const label = row.kind === "thinking" ? "thinking" : row.name;
	const detail =
		row.kind === "thinking"
			? `<span class="step-row-thinking" title="${escapeHtml(oneLine(row.text))}">${escapeHtml(oneLine(row.text))}</span>`
			: `<span class="step-row-args" title="${escapeHtml(row.arg)}">${escapeHtml(row.arg)}</span>${row.result ? `<span class="step-sep">|</span><span class="step-row-result" title="${escapeHtml(oneLine(row.result))}">${escapeHtml(oneLine(row.result))}</span>` : ""}`;
	entry.innerHTML = `<button class="step-row" type="button" aria-expanded="false">${icon(iconName, "step-row-icon")}<span class="step-row-label">${escapeHtml(label)}</span><span class="step-row-detail">${detail}</span><span class="step-row-took">${took}</span><span class="step-row-chev">${icon("chevron")}</span></button>`;
	const button = entry.querySelector(".step-row");
	button.addEventListener("click", () => {
		const open = entry.querySelector(".step-detail");
		const chevron = button.querySelector(".step-row-chev");
		if (open !== null) {
			open.remove();
			button.setAttribute("aria-expanded", "false");
			chevron.classList.remove("is-open");
			return;
		}
		const panel = document.createElement("div");
		if (row.kind === "thinking") {
			panel.className = "step-detail is-think";
			panel.innerHTML = '<div class="step-detail-scroll"><div class="md"></div></div>';
			panel.querySelector(".md").textContent = row.text;
		} else {
			panel.className = "step-detail";
			panel.innerHTML =
				'<div class="step-detail-scroll"><section class="step-detail-section"><span class="step-detail-label">args</span><pre class="step-detail-code"></pre></section><section class="step-detail-section"><span class="step-detail-label">result</span><pre class="step-detail-code"></pre></section></div>';
			const blocks = panel.querySelectorAll("pre");
			blocks[0].textContent = row.arg;
			blocks[1].textContent = row.result || "(no output)";
		}
		entry.append(panel);
		button.setAttribute("aria-expanded", "true");
		chevron.classList.add("is-open");
	});
	return entry;
}

function familyMarkup(rows) {
	const counts = new Map();
	for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
	return [...counts].map(([kind, count]) => `<span class="step-family">${icon(kind === "thinking" ? "brain" : "wrench")}<span>${kind}</span><b>${count}</b></span>`).join("");
}

function latestMarkup(rows) {
	const last = rows[rows.length - 1];
	if (last.kind === "thinking") {
		return `<span class="step-latest">${icon("brain")}<span class="step-latest-label">thinking</span><span class="step-latest-detail">${escapeHtml(oneLine(last.text))}</span></span>`;
	}
	return `<span class="step-latest">${icon(toolIcon(last.name))}<span class="step-latest-label">${escapeHtml(last.name)}</span><span class="step-sep">·</span><span class="step-latest-detail">${escapeHtml(last.arg)}</span></span>`;
}

function ribbonEl() {
	const ribbon = document.createElement("div");
	ribbon.className = "step-ribbon";
	ribbon.dataset.open = "true";
	ribbon.dataset.live = "true";
	const head = document.createElement("button");
	head.className = "step-head";
	head.type = "button";
	head.setAttribute("aria-expanded", "true");
	head.innerHTML = `<span class="step-chev">${icon("chevron")}</span>`;
	head.addEventListener("click", () => {
		if (ribbon.dataset.live === "true") return;
		const open = ribbon.dataset.open === "true";
		ribbon.dataset.open = String(!open);
		head.setAttribute("aria-expanded", String(!open));
	});
	const body = document.createElement("div");
	body.className = "step-body";
	const bodyInner = document.createElement("div");
	bodyInner.className = "step-body-inner";
	const ledger = document.createElement("div");
	ledger.className = "step-ledger";
	bodyInner.append(ledger);
	body.append(bodyInner);
	ribbon.append(head, body);
	return ribbon;
}

function liveHead(ribbon, group, index) {
	const row = group.rows[index];
	const head = ribbon.querySelector(".step-head");
	const label = row.kind === "thinking" ? "thinking" : row.name;
	const detail = row.kind === "thinking" ? oneLine(row.text) : row.arg;
	head.innerHTML = `<span class="step-chev">${icon("chevron")}</span><span class="step-stamp">Running for</span><span class="step-duration">${index + 1}s</span><span class="work-dot"></span><span class="step-latest">${icon(row.kind === "thinking" ? "brain" : toolIcon(row.name))}<span class="step-latest-label">${escapeHtml(label)}</span><span class="step-sep">·</span><span class="step-latest-detail">${escapeHtml(detail)}</span></span>`;
}

function completeHead(ribbon, group) {
	const rows = group.rows;
	const took = span(rows[rows.length - 1].time - rows[0].time);
	const head = ribbon.querySelector(".step-head");
	head.innerHTML = `<span class="step-chev">${icon("chevron")}</span><span class="step-stamp">${took === "" ? "Completed" : "Completed in"}</span>${took === "" ? "" : `<span class="step-duration">${took}</span>`}<span class="step-families">${familyMarkup(rows)}</span>${latestMarkup(rows)}`;
	ribbon.dataset.open = "false";
	ribbon.dataset.live = "false";
	head.setAttribute("aria-expanded", "false");
}

function renderSidebar() {
	rowsEl.innerHTML = SESSIONS.map((session) => {
		const selectedRow = session.id === selected;
		const running = playing && selectedRow;
		const workspace = session.worktree
			? `${icon("folder-tree")}<span class="row-repo">${session.repo}</span><span class="branch">next</span>`
			: `${icon("folder")}<span class="row-repo">${session.repo}</span>`;
		return `
					<div class="row${selectedRow ? " is-selected" : ""}${running ? " is-running" : ""}" role="listitem" tabindex="0" data-id="${session.id}" aria-current="${selectedRow ? "true" : "false"}" aria-label="${session.name}">
						<div class="row-meta">${workspace}<span class="row-right">${running ? '<span class="session-status is-live"><span>WRITING</span></span>' : ""}<span class="when">${session.when}</span></span></div>
						<div class="row-name">${session.name}</div>
						<div class="row-preview">${session.preview}</div>
						<span class="row-menu" aria-hidden="true">${icon("ellipsis")}</span>
					</div>`;
	}).join("");
	rowsEl.querySelectorAll(".row").forEach((row) => {
		const session = SESSIONS.find((each) => each.id === row.dataset.id);
		if (session === undefined) return;
		row.addEventListener("click", () => void play(session));
		row.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			void play(session);
		});
	});
}

function setPlaying(on) {
	playing = on;
	barStatus.classList.toggle("is-on", on);
	renderSidebar();
	replayBtn.classList.toggle("is-busy", on);
	replayLabel.textContent = on ? "Replaying…" : "Replay";
}

let runId = 0;
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function play(session) {
	current = session ?? current;
	const token = ++runId;
	selected = current.id;
	setPlaying(true);
	barName.textContent = current.name;
	inner.innerHTML = "";
	const reduced = reducedMotion.matches;
	for (const row of current.transcript) {
		if (token !== runId) return;
		if (row.type === "step") {
			const ribbon = ribbonEl();
			const ledger = ribbon.querySelector(".step-ledger");
			inner.append(ribbon);
			if (reduced) {
				row.rows.forEach((step, index) => ledger.append(stepEntry(step, index === 0 ? undefined : row.rows[index - 1])));
				completeHead(ribbon, row);
				continue;
			}
			for (const [index, step] of row.rows.entries()) {
				if (token !== runId) return;
				ledger.append(stepEntry(step, index === 0 ? undefined : row.rows[index - 1]));
				liveHead(ribbon, row, index);
				scrollBottom();
				await wait(650);
			}
			if (token !== runId) return;
			completeHead(ribbon, row);
			scrollBottom();
			await wait(300);
		} else if (row.kind === "user") {
			inner.append(userBlock(row.text, row.at, row.id));
			scrollBottom();
			await wait(reduced ? 0 : 700);
		} else {
			const block = answerBlock(row);
			inner.append(block);
			const reply = block.querySelector(".reply");
			if (reduced) {
				reply.innerHTML = row.html;
			} else {
				reply.classList.add("is-typing");
				await typeInto(reply, row.html, token);
				reply.classList.remove("is-typing");
			}
			block.append(answerMeta(row));
			scrollBottom();
			await wait(reduced ? 0 : 400);
		}
	}
	if (token !== runId) return;
	setPlaying(false);
	scrollBottom();
}

document.addEventListener("click", (event) => {
	const button = event.target.closest(".msg-copy");
	if (button === null) return;
	navigator.clipboard?.writeText(button.dataset.copy ?? "").catch(() => undefined);
	const use = button.querySelector("use");
	use.setAttribute("href", "#i-check");
	button.classList.add("copied");
	window.setTimeout(() => {
		use.setAttribute("href", "#i-copy");
		button.classList.remove("copied");
	}, 1200);
});

replayBtn.addEventListener("click", () => {
	if (playing) return;
	runId += 1;
	setPlaying(false);
	inner.innerHTML = "";
	document.getElementById("starter-row").hidden = false;
});

const starterRow = document.getElementById("starter-row");
document.getElementById("starter").addEventListener("click", () => {
	if (playing) return;
	starterRow.hidden = true;
	void play(current);
});

models.querySelector("button").addEventListener("click", () => models.classList.toggle("is-open"));

const app = document.querySelector(".app");
const grip = document.getElementById("grip");
const chatBar = document.querySelector(".chat-bar");
const collapseBtn = document.getElementById("list-collapse");
const expandBtn = document.getElementById("list-expand");
let listWidth = 240;
let dragging = false;
let revealTimer = 0;
const readoutFor = () => `${Math.round(listWidth)} / ${Math.round(app.clientWidth - listWidth - 7)}`;
const showReadout = () => {
	let readout = grip.querySelector(".grip-read");
	if (readout === null) {
		readout = document.createElement("span");
		readout.className = "grip-read";
		grip.append(readout);
	}
	readout.textContent = readoutFor();
	grip.classList.add("revealed");
};
const hideReadout = () => {
	if (dragging) return;
	grip.classList.remove("revealed");
	grip.querySelector(".grip-read")?.remove();
};
const setListWidth = (value) => {
	listWidth = Math.max(200, Math.min(480, value));
	app.style.setProperty("--list-width", `${listWidth}px`);
	grip.setAttribute("aria-valuenow", String(Math.round(listWidth)));
	const readout = grip.querySelector(".grip-read");
	if (readout !== null) readout.textContent = readoutFor();
};
const setCollapsed = (collapsed) => {
	app.classList.toggle("is-collapsed", collapsed);
	chatBar.classList.toggle("at-edge", collapsed);
};
collapseBtn.addEventListener("click", () => setCollapsed(true));
expandBtn.addEventListener("click", () => setCollapsed(false));
document.addEventListener("keydown", (event) => {
	if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
	event.preventDefault();
	setCollapsed(!app.classList.contains("is-collapsed"));
});
grip.addEventListener("pointerdown", (event) => {
	event.preventDefault();
	dragging = true;
	grip.classList.add("dragging");
	document.body.classList.add("pane-dragging");
	showReadout();
	const startX = event.clientX;
	const startWidth = listWidth;
	const move = (moveEvent) => setListWidth(startWidth + moveEvent.clientX - startX);
	const up = () => {
		dragging = false;
		grip.classList.remove("dragging");
		document.body.classList.remove("pane-dragging");
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		hideReadout();
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
});
grip.addEventListener("pointerenter", () => {
	if (revealTimer !== 0 || dragging) return;
	revealTimer = window.setTimeout(() => {
		revealTimer = 0;
		showReadout();
	}, 350);
});
grip.addEventListener("pointerleave", () => {
	if (revealTimer !== 0) {
		window.clearTimeout(revealTimer);
		revealTimer = 0;
	}
	hideReadout();
});
grip.addEventListener("focus", showReadout);
grip.addEventListener("blur", hideReadout);
grip.addEventListener("dblclick", () => {
	setListWidth(240);
	showReadout();
});
grip.addEventListener("keydown", (event) => {
	const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
	if (step === 0) return;
	event.preventDefault();
	setListWidth(listWidth + step);
	showReadout();
});

renderSidebar();

// ——— replies & trajectory ———

const panes = current.panes;
const repliesToggle = document.getElementById("replies-toggle");
const trajectoryToggle = document.getElementById("trajectory-toggle");
const repliesPane = document.getElementById("replies-pane");
const trajectoryPane = document.getElementById("trajectory-pane");
const trajectoryList = document.getElementById("trajectory-list");
const trajectoryFoot = document.getElementById("trajectory-foot");
const trajectoryPop = document.getElementById("trajectory-pop");
const trajectoryModes = [...trajectoryPane.querySelectorAll(".trajectory-mode")];
let trajectoryMode = "origin";
let trajectorySelected = null;
let repliesOpen = false;
let trajectoryOpen = false;

const setToggle = (button, open, show, hide) => {
	button.classList.toggle("is-on", open);
	button.setAttribute("aria-pressed", open ? "true" : "false");
	button.setAttribute("aria-label", open ? hide : show);
	if (button.hasAttribute("title")) button.setAttribute("title", open ? hide : show);
	button.dataset.tip = open ? hide : show;
};

const label = (text) => {
	const line =
		String(text)
			.split("\n")
			.find((each) => each.trim() !== "") ?? "";
	return line.length > 42 ? `${line.slice(0, 42)}…` : line;
};

const focusQuestion = (id) => {
	if (id === null || id === undefined) return;
	const target = inner.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
	if (target === null) return;
	const box = transcript.getBoundingClientRect();
	const rect = target.getBoundingClientRect();
	transcript.scrollBy({ top: rect.top - box.top - box.height / 2 + rect.height / 2, behavior: "smooth" });
	const flash = target.querySelector(".msg-user-text, .reply") ?? target;
	flash.classList.remove("is-located");
	void flash.offsetWidth;
	flash.classList.add("is-located");
	window.setTimeout(() => flash.classList.remove("is-located"), 1500);
};

function renderReplies() {
	repliesPane.textContent = "";
	const head = document.createElement("div");
	head.className = "replies-head";
	const title = document.createElement("span");
	title.className = "replies-title";
	title.textContent = "Replies";
	const count = document.createElement("span");
	count.className = "replies-count";
	count.textContent = String(panes.replies.length);
	head.append(title, count);
	const list = document.createElement("div");
	list.className = "replies-list";
	if (panes.replies.length === 0) {
		const empty = document.createElement("span");
		empty.className = "replies-empty";
		empty.textContent = "no replies yet";
		list.append(empty);
	}
	for (const reply of panes.replies) {
		const row = document.createElement("button");
		row.type = "button";
		row.className = "reply-row";
		const top = document.createElement("span");
		top.className = "reply-row-top";
		const question = document.createElement("span");
		question.className = "reply-question";
		question.textContent = reply.question ? label(reply.question) : "—";
		const time = document.createElement("span");
		time.className = "reply-time";
		time.textContent = reply.at;
		top.append(question, time);
		const text = document.createElement("span");
		text.className = "reply-text";
		text.textContent = label(reply.text);
		row.append(top, text);
		row.addEventListener("click", () => {
			for (const other of list.querySelectorAll(".reply-row")) other.classList.toggle("is-active", other === row);
			focusQuestion(reply.questionId);
		});
		list.append(row);
	}
	repliesPane.append(head, list);
}

const trajectoryRows = () => {
	if (trajectoryMode === "view") return panes.trajectory.view.rows;
	if (trajectoryMode === "slice") return panes.trajectory.slice.rows;
	return panes.trajectory.origin.rows;
};

function renderTrajectory() {
	const rows = trajectoryRows();
	trajectoryList.textContent = "";
	if (rows.length === 0) {
		const empty = document.createElement("div");
		empty.className = "trajectory-empty";
		empty.textContent = "no log entries yet — run a conversation first";
		trajectoryList.append(empty);
	}
	for (const row of rows) {
		const wrap = document.createElement("div");
		wrap.className = `trajectory-row${row.runStart ? " is-run-start" : ""}${row.key === trajectorySelected ? " is-selected" : ""}`;
		const button = document.createElement("button");
		button.type = "button";
		const chip = document.createElement("b");
		chip.className = "trajectory-chip";
		chip.dataset.tone = row.tone;
		chip.textContent = row.chip;
		const caption = document.createElement("span");
		caption.className = "trajectory-caption";
		caption.dataset.tone = row.tone;
		caption.textContent = row.caption.length > 60 ? `${row.caption.slice(0, 60)}…` : row.caption;
		button.append(chip, caption);
		button.addEventListener("click", () => {
			trajectorySelected = trajectorySelected === row.key ? null : row.key;
			renderTrajectory();
		});
		wrap.append(button);
		trajectoryList.append(wrap);
	}
	for (const mode of trajectoryModes) {
		const on = mode.dataset.mode === trajectoryMode;
		mode.classList.toggle("is-on", on);
		mode.setAttribute("aria-pressed", on ? "true" : "false");
	}
	const meta = panes.trajectory;
	const turns = meta.slice.turns;
	if (trajectoryMode === "slice") {
		trajectoryFoot.innerHTML = `<span>slice · ${rows.length} nodes shown · ${turns} turns</span><span>model context (slice)</span>`;
	} else if (trajectoryMode === "view") {
		trajectoryFoot.innerHTML = `<span>view · ${rows.length} rows shown</span><span>chat view</span>`;
	} else {
		trajectoryFoot.innerHTML = `<span>origin · all ${meta.origin.entries} entries · ${meta.origin.turns} turns</span><span>whole log · paged</span>`;
	}
	renderTrajectoryPop();
}

function detailNode(detail) {
	const fragment = document.createDocumentFragment();
	const hasLabel = detail.label !== undefined && detail.label !== "";
	const hasDescription = detail.description !== undefined && detail.description !== "";
	const head = document.createElement("div");
	if (hasLabel) {
		head.className = "trajectory-detail-label";
		const name = document.createElement("span");
		name.textContent = detail.label;
		head.append(name);
		if (hasDescription) {
			const description = document.createElement("span");
			description.textContent = detail.description;
			head.append(description);
		}
	} else if (hasDescription) {
		head.className = "trajectory-detail-description";
		head.textContent = detail.description;
	}
	if (hasLabel || hasDescription) fragment.append(head);
	const content = detail.content;
	if (content !== undefined && content.kind === "text") {
		const text = document.createElement("div");
		text.className = `trajectory-detail-text${detail.error ? " is-error" : ""}`;
		text.textContent = content.value;
		fragment.append(text);
	}
	if (Array.isArray(detail.meta) && detail.meta.length > 0) {
		const meta = document.createElement("div");
		meta.className = `trajectory-detail-meta${detail.error ? " is-error" : ""}`;
		for (const fact of detail.meta) {
			const item = document.createElement("span");
			item.textContent = fact;
			meta.append(item);
		}
		fragment.append(meta);
	}
	if (content !== undefined && content.kind !== "text") {
		const code = document.createElement("pre");
		code.className = `trajectory-detail-code${detail.error ? " is-error" : ""}`;
		code.textContent = content.value;
		fragment.append(code);
	}
	return fragment;
}

function positionTrajectoryPop() {
	const row = trajectoryList.querySelector(".trajectory-row.is-selected");
	if (row === null) return;
	const pane = trajectoryPane.getBoundingClientRect();
	const box = row.getBoundingClientRect();
	const height = trajectoryPop.offsetHeight;
	const centre = box.top + box.height / 2 - pane.top;
	const top = Math.min(Math.max(centre - height / 2, 8), Math.max(8, pane.height - height - 8));
	trajectoryPop.style.top = `${top}px`;
}

function renderTrajectoryPop() {
	const row = trajectoryRows().find((each) => each.key === trajectorySelected);
	trajectoryPop.textContent = "";
	if (row === undefined) {
		trajectoryPop.hidden = true;
		return;
	}
	trajectoryPop.hidden = false;
	const head = document.createElement("div");
	head.className = "trajectory-pop-head";
	const chip = document.createElement("span");
	chip.className = "trajectory-pop-chip";
	chip.textContent = row.chip;
	const caption = document.createElement("span");
	caption.className = "trajectory-pop-caption";
	caption.textContent = row.caption;
	const close = document.createElement("button");
	close.className = "trajectory-pop-close";
	close.type = "button";
	close.setAttribute("aria-label", "Close");
	close.textContent = "×";
	close.addEventListener("click", () => {
		trajectorySelected = null;
		renderTrajectory();
	});
	head.append(chip, caption, close);
	const body = document.createElement("div");
	body.className = "trajectory-pop-body";
	for (const detail of row.details) body.append(detailNode(detail));
	const foot = document.createElement("div");
	foot.className = "trajectory-pop-foot";
	foot.textContent = `entry ${row.entryId} · ${row.stamp}`;
	trajectoryPop.append(head, body, foot);
	positionTrajectoryPop();
}

repliesToggle.addEventListener("click", () => {
	repliesOpen = !repliesOpen;
	repliesPane.hidden = !repliesOpen;
	setToggle(repliesToggle, repliesOpen, "Show Replies", "Hide Replies");
});

trajectoryToggle.addEventListener("click", () => {
	trajectoryOpen = !trajectoryOpen;
	trajectoryPane.hidden = !trajectoryOpen;
	setToggle(trajectoryToggle, trajectoryOpen, "Show Trajectory", "Hide Trajectory");
	if (trajectoryOpen) {
		renderTrajectory();
		return;
	}
	trajectorySelected = null;
	trajectoryPop.hidden = true;
});

trajectoryPane.querySelector(".trajectory-close").addEventListener("click", () => {
	trajectoryOpen = false;
	trajectoryMode = "origin";
	trajectorySelected = null;
	trajectoryPane.hidden = true;
	trajectoryPop.hidden = true;
	setToggle(trajectoryToggle, false, "Show Trajectory", "Hide Trajectory");
});

for (const mode of trajectoryModes) {
	mode.addEventListener("click", () => {
		const next = mode.dataset.mode;
		trajectoryMode = trajectoryMode === next ? "origin" : next;
		trajectorySelected = null;
		renderTrajectory();
	});
}

document.addEventListener("keydown", (event) => {
	if (event.key !== "Escape" || !trajectoryOpen) return;
	if (trajectorySelected !== null) {
		trajectorySelected = null;
		renderTrajectory();
		return;
	}
	trajectoryOpen = false;
	trajectoryMode = "origin";
	trajectoryPane.hidden = true;
	trajectoryPop.hidden = true;
	setToggle(trajectoryToggle, false, "Show Trajectory", "Hide Trajectory");
});

renderReplies();

const tip = document.createElement("div");
tip.className = "tip-bubble";
tip.hidden = true;
document.body.append(tip);
let tipTimer = 0;
let tipTarget = null;
const hideTip = () => {
	if (tipTimer !== 0) {
		window.clearTimeout(tipTimer);
		tipTimer = 0;
	}
	tipTarget = null;
	tip.hidden = true;
};
const showTip = (el) => {
	tipTarget = el;
	tip.textContent = el.dataset.tip ?? "";
	tip.hidden = false;
	const rect = el.getBoundingClientRect();
	const above = rect.top > 40;
	tip.dataset.side = above ? "top" : "bottom";
	tip.style.left = `${Math.min(Math.max(rect.left + rect.width / 2, 84), window.innerWidth - 84)}px`;
	tip.style.top = above ? `${rect.top - 4}px` : `${rect.bottom + 4}px`;
};
document.querySelectorAll("button[title]").forEach((el) => {
	const text = el.getAttribute("title") ?? "";
	if (text === "") return;
	el.dataset.tip = text;
	el.removeAttribute("title");
	el.addEventListener("pointerenter", () => {
		if (tipTarget !== null) return;
		tipTimer = window.setTimeout(() => {
			tipTimer = 0;
			showTip(el);
		}, 120);
	});
	el.addEventListener("pointerleave", () => {
		if (tipTimer !== 0) {
			window.clearTimeout(tipTimer);
			tipTimer = 0;
		}
		if (tipTarget === el) hideTip();
	});
	el.addEventListener("focus", () => showTip(el));
	el.addEventListener("blur", () => {
		if (tipTarget === el) hideTip();
	});
	el.addEventListener("click", hideTip);
});
window.addEventListener("scroll", hideTip, { passive: true });

const root = document.documentElement;
const stored = localStorage.getItem("milu.site.theme");
if (stored === "light" || stored === "dark") root.dataset.theme = stored;
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
document.querySelector(".theme-btn").addEventListener("click", () => {
	const active = root.dataset.theme ?? (prefersDark.matches ? "dark" : "light");
	root.dataset.theme = active === "dark" ? "light" : "dark";
	localStorage.setItem("milu.site.theme", root.dataset.theme);
});

const nav = document.querySelector(".nav");
const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });
