/**
 * App — the controller. Owns app state (busy/queued/turn), wires RPC events
 * into transcript entries, and renders the shell (header, status, composer).
 */
import { createSignal } from "solid-js";
import { Electroview } from "electrobun/view";
import type { AppRPCSchema } from "../shared/rpc";
import { Transcript, fmtTime, makeAgentEntry, makeSepEntry, makeSysEntry, makeUserEntry, SEPARATOR_GAP_MS, type Entry } from "./Transcript";
import { Composer } from "./Composer";

// ————— RPC —————
const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: { requests: {}, messages: {} },
});
new Electroview({ rpc });

export function App() {
	// ————— state —————
	const [entries, setEntries] = createSignal<Entry[]>([]);
	const [busy, setBusy] = createSignal(false);
	const [queued, setQueued] = createSignal(0);
	const [turn, setTurn] = createSignal(0);
	const [error, setError] = createSignal<string | null>(null);
	const [streamingId, setStreamingId] = createSignal<number | null>(null);
	const [tick, setTick] = createSignal(0);
	let lastMsgTime = 0;
	const toolEls = new Map<string, number>();

	const bump = () => setTick((t) => t + 1);
	const push = (entry: Entry) => {
		setEntries((prev) => [...prev, entry]);
		bump();
	};

	// ————— transcript building —————
	function maybeTimeSeparator(d: Date) {
		if (lastMsgTime && d.getTime() - lastMsgTime > SEPARATOR_GAP_MS) {
			const sameDay = new Date(lastMsgTime).toDateString() === d.toDateString();
			push(makeSepEntry(sameDay ? fmtTime(d) : `${d.getMonth() + 1}/${d.getDate()} · ${fmtTime(d)}`));
		}
		lastMsgTime = d.getTime();
	}

	function addUser(text: string) {
		if (busy()) push(makeSysEntry("✳ follow-up queued"));
		maybeTimeSeparator(new Date());
		push(makeUserEntry(text));
	}

	function openAgent(turn: number) {
		if (streamingId() != null) {
			// Same run, new turn → the outer loop drained a follow-up.
			push(makeSysEntry(`✳ follow-up · turn ${turn}`));
		} else {
			const entry = makeAgentEntry();
			setStreamingId(entry.id);
			push(entry);
		}
	}

	function addTool(name: string, status: "start" | "end") {
		if (status === "start") {
			const entry = makeSysEntry(`⇢ ${name} · running…`);
			toolEls.set(name, entry.id);
			push(entry);
		} else {
			const id = toolEls.get(name);
			if (id != null) {
				// mutate in place — new objects would rebuild the whole list
				setEntries((prev) => {
					prev.forEach((entry) => {
						if (entry.id === id && entry.kind === "sys") {
							entry.setText(`⇢ ${name} · ran ✓`);
						}
					});
					return prev;
				});
				toolEls.delete(name);
				bump();
			}
		}
	}

	function finishAgent(err?: string) {
		setStreamingId(null);
		if (err) push(makeSysEntry(`ERR § ${err}`, true));
		bump();
	}

	// ————— RPC events → state + entries —————
	rpc.addMessageListener("agent_turn", ({ turn: t }) => {
		setBusy(true);
		setTurn(t);
		openAgent(t);
		if (queued() > 0) setQueued((q) => q - 1);
	});

	rpc.addMessageListener("agent_delta", ({ text }) => {
		if (streamingId() == null) openAgent(1);
		const entry = entries().find((e) => e.id === streamingId());
		if (entry && entry.kind === "agent") {
			entry.setText((prev) => prev + text);
		}
		bump();
	});

	rpc.addMessageListener("agent_tool", ({ name, status }) => {
		addTool(name, status);
	});

	rpc.addMessageListener("agent_end", ({ error: err }) => {
		setBusy(false);
		setQueued(0);
		setError(err ?? null);
		finishAgent(err);
	});

	// ————— user input —————
	function onSend(text: string) {
		addUser(text);
		if (busy()) setQueued((q) => q + 1);
		void rpc.request.chat({ text });
	}

	const statusText = () => (busy() ? `AGENT: RUNNING · TURN ${turn()}` : error() ? "AGENT: ERROR" : "AGENT: IDLE");
	const statusExtra = () => (queued() > 0 ? `· ${queued()} queued` : "");

	// ————— shell —————
	return (
		<>
			<header class="electrobun-webkit-app-region-drag shrink-0 h-12 flex items-center justify-center select-none">
				<span class="font-serif font-bold uppercase text-[16px] tracking-[0.08em] text-ink">Coding Desktop</span>
			</header>

			<Transcript entries={entries} streamingId={streamingId} tick={tick} />

			<footer class="shrink-0 px-3 pt-1 pb-3">
				<div class={"status" + (busy() ? " running" : "")} id="status">
					<span class="status-dot" id="status-dot" />
					<span class="status-text" id="status-text">
						{statusText()}
					</span>
					<span class="flex-1" />
					<span class="status-extra" id="status-extra">
						{statusExtra()}
					</span>
				</div>
				<Composer busy={busy} onSend={onSend} onStop={() => void rpc.request.stop({})} />
			</footer>
		</>
	);
}
