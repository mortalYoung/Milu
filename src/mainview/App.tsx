export function App() {
	return (
		<div className="flex h-full flex-col">
			<header className="flex items-center gap-2 border-b border-hairline px-6 py-4">
				<span className="font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Letters</span>
			</header>
			<main className="grid flex-1 place-items-center">
				<span className="font-mono text-[11px] text-muted">shell · react 19</span>
			</main>
		</div>
	);
}
