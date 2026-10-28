import { api, React, useEffect, useState } from "./runtime.ts";
import { createSampler, type TelemetrySample } from "./sampler.ts";
import { Sparkline } from "./sparkline.tsx";
import { STYLES } from "./styles.ts";

const MAX_SAMPLES = 60;
const OPEN_KEY = "milu.telemetry.open";

const TABS: readonly { id: Tab; label: string }[] = [
	{ id: "frame", label: "Frame" },
	{ id: "memory", label: "Memory" },
	{ id: "main", label: "Main" },
];

type Tab = "frame" | "memory" | "main";
type Tone = "ok" | "warn" | "danger";

function toneOf(fps: number): Tone {
	if (fps === 0) return "ok";
	if (fps < 40) return "danger";
	if (fps < 55) return "warn";
	return "ok";
}

function formatBytes(value: number): string {
	if (value <= 0) return "—";
	const units = ["B", "KB", "MB", "GB"];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return `${unit === 0 || size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function formatMs(value: number): string {
	if (value <= 0) return "0 ms";
	return value >= 100 ? `${Math.round(value)} ms` : `${value.toFixed(1)} ms`;
}

function sum(history: readonly TelemetrySample[], pick: (sample: TelemetrySample) => number): number {
	return history.reduce((total, sample) => total + pick(sample), 0);
}

function peak(history: readonly TelemetrySample[], pick: (sample: TelemetrySample) => number): number {
	return history.reduce((max, sample) => Math.max(max, pick(sample)), 0);
}

function chromiumVersion(): string | null {
	return /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? null;
}

function fallbackCopy(text: string): void {
	const area = document.createElement("textarea");
	area.value = text;
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.append(area);
	area.select();
	document.execCommand("copy");
	area.remove();
}

function writeClipboard(text: string): void {
	if (navigator.clipboard === undefined) {
		fallbackCopy(text);
		return;
	}
	void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
}

let rememberedOpen = false;

function storedOpen(): boolean {
	try {
		const stored = sessionStorage.getItem(OPEN_KEY);
		if (stored !== null) {
			rememberedOpen = stored === "1";
			return rememberedOpen;
		}
	} catch {}
	return rememberedOpen;
}

function storeOpen(open: boolean): void {
	rememberedOpen = open;
	try {
		sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
	} catch {}
}

function useTelemetry(): { history: readonly TelemetrySample[]; reset: () => void } {
	const [history, setHistory] = useState<readonly TelemetrySample[]>([]);
	const [sampler] = useState(() =>
		createSampler((sample) => {
			setHistory((previous) => [...previous.slice(-(MAX_SAMPLES - 1)), sample]);
		}),
	);

	useEffect(() => {
		sampler.start();
		return () => sampler.stop();
	}, [sampler]);

	return {
		history,
		reset: () => {
			sampler.reset();
			setHistory([]);
		},
	};
}

function Row(props: { label: string; value: string }) {
	return (
		<div className="telemetry-row">
			<span>{props.label}</span>
			<b title={props.value}>{props.value}</b>
		</div>
	);
}

function FrameTab(props: { current: TelemetrySample | null; history: readonly TelemetrySample[] }) {
	const fps = props.history.map((sample) => sample.fps);
	return (
		<>
			<div className="telemetry-hero">
				<span className="telemetry-value" data-tone={props.current ? toneOf(props.current.fps) : "ok"}>
					{props.current ? props.current.fps : "—"}
				</span>
				<span className="telemetry-unit">fps</span>
			</div>
			<Sparkline values={fps} min={0} max={Math.max(60, ...fps)} />
			<div className="telemetry-rows">
				<Row label="frame" value={props.current ? formatMs(props.current.frameMs) : "—"} />
				<Row label="p95" value={props.current ? formatMs(props.current.frameP95) : "—"} />
				<Row label="jank" value={props.current ? `${props.current.jank} / s` : "—"} />
			</div>
		</>
	);
}

function MemoryTab(props: { current: TelemetrySample | null; history: readonly TelemetrySample[] }) {
	const current = props.current;
	const available = current !== null && current.heapLimit > 0;
	const percent = available ? Math.round((current.heapUsed / current.heapLimit) * 100) : 0;
	const ratio = props.history.map((sample) => (sample.heapLimit > 0 ? (sample.heapUsed / sample.heapLimit) * 100 : 0));
	return (
		<>
			<div className="telemetry-hero">
				<span className="telemetry-value" data-tone={percent >= 90 ? "danger" : percent >= 75 ? "warn" : "ok"}>
					{available ? percent : "—"}
				</span>
				<span className="telemetry-unit">% heap</span>
			</div>
			<div className="telemetry-bar">
				<i style={{ width: `${percent}%` }} />
			</div>
			<div className="telemetry-rows">
				<Row label="heap" value={available ? `${formatBytes(current.heapUsed)} / ${formatBytes(current.heapLimit)}` : "unavailable"} />
				<Row label="dom nodes" value={current ? current.nodes.toLocaleString() : "—"} />
				<Row label="samples" value={String(props.history.length)} />
			</div>
			{available ? <Sparkline values={ratio} min={0} max={100} /> : null}
		</>
	);
}

function MainTab(props: { current: TelemetrySample | null; history: readonly TelemetrySample[]; session: string | null }) {
	const longTasks = sum(props.history, (sample) => sample.longTasks);
	const longTaskMs = sum(props.history, (sample) => sample.longTaskMs);
	const lagPeak = peak(props.history, (sample) => sample.lagMs);
	return (
		<div className="telemetry-rows">
			<Row label="long tasks" value={`${longTasks} · ${formatMs(longTaskMs)}`} />
			<Row label="loop lag" value={props.current ? formatMs(props.current.lagMs) : "—"} />
			<Row label="lag peak" value={formatMs(lagPeak)} />
			<Row label="session" value={props.session ?? "—"} />
			<Row label="viewport" value={`${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x`} />
			<Row label="chromium" value={chromiumVersion() ?? "—"} />
		</div>
	);
}

export function TelemetryBall() {
	const session = api.useSession();
	const { history, reset } = useTelemetry();
	const [open, setOpenState] = useState(storedOpen);
	const [tab, setTab] = useState<Tab>("frame");
	const [copied, setCopied] = useState(false);
	const current = history[history.length - 1] ?? null;
	const tone = current ? toneOf(current.fps) : "ok";
	const setOpen = (next: boolean): void => {
		storeOpen(next);
		setOpenState(next);
	};

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

	const copy = (): void => {
		const snapshot = {
			at: new Date().toISOString(),
			session,
			environment: {
				viewport: `${window.innerWidth}×${window.innerHeight}`,
				dpr: window.devicePixelRatio,
				cores: navigator.hardwareConcurrency,
				chromium: chromiumVersion(),
				visibility: document.visibilityState,
			},
			history,
		};
		writeClipboard(JSON.stringify(snapshot, null, 2));
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1200);
	};

	return (
		<div className="milu-ext-telemetry">
			<style>{STYLES}</style>
			{open ? (
				<div className="telemetry-panel" role="dialog" aria-label="Runtime telemetry">
					<div className="telemetry-head">
						<span className="telemetry-live" data-tone={tone} />
						<span className="telemetry-title">Runtime</span>
						<span className="telemetry-badge">DEV</span>
						<button type="button" className="telemetry-close" aria-label="Close telemetry" onClick={() => setOpen(false)}>
							×
						</button>
					</div>
					<div className="telemetry-tabs" role="tablist">
						{TABS.map((each) => (
							<button
								key={each.id}
								type="button"
								role="tab"
								aria-selected={tab === each.id}
								className="telemetry-tab"
								data-active={tab === each.id}
								onClick={() => setTab(each.id)}
							>
								{each.label}
							</button>
						))}
					</div>
					<div className="telemetry-body">
						{tab === "frame" ? <FrameTab current={current} history={history} /> : null}
						{tab === "memory" ? <MemoryTab current={current} history={history} /> : null}
						{tab === "main" ? <MainTab current={current} history={history} session={session} /> : null}
					</div>
					<div className="telemetry-foot">
						<button type="button" className="telemetry-button" onClick={reset}>
							Reset
						</button>
						<button type="button" className="telemetry-button" onClick={copy}>
							{copied ? "Copied" : "Copy snapshot"}
						</button>
					</div>
				</div>
			) : null}
			<button
				type="button"
				className="telemetry-ball"
				aria-label="Runtime telemetry"
				aria-haspopup="dialog"
				aria-expanded={open}
				title="Runtime telemetry"
				onClick={() => setOpen(!open)}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M3 12h4l3-8 4 16 3-8h4" />
				</svg>
				<span className="telemetry-dot" data-tone={tone} />
			</button>
		</div>
	);
}

export default TelemetryBall;
