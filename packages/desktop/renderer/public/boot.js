// Runs before the shell paints: the cached theme decides the first frame's colours, and a boot that
// outlives a blink says so with the mark alone.
(() => {
	const root = document.documentElement;
	try {
		const raw = localStorage.getItem("milu.theme");
		const cached = raw === null ? null : JSON.parse(raw);
		if (cached && typeof cached === "object") {
			root.style.colorScheme = cached.appearance === "dark" ? "dark" : "light";
			for (const [key, token] of Object.entries(cached.tokens ?? {})) {
				if (typeof token === "string") root.style.setProperty(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`, token);
			}
		}
		const width = Number(localStorage.getItem("milu.layout.list"));
		if (localStorage.getItem("milu.layout.listOpen") === "0") root.dataset.bootList = "closed";
		else if (Number.isFinite(width) && width > 0) root.style.setProperty("--boot-list", `${Math.min(Math.max(width, 200), 480)}px`);
	} catch {}

	document.addEventListener("DOMContentLoaded", () => {
		const boot = document.getElementById("boot");
		const hold = document.getElementById("boot-hold");
		const retry = document.getElementById("boot-retry");
		if (!boot || !hold || !retry) return;
		const later = (ms, act) =>
			setTimeout(() => {
				if (boot.isConnected) act();
			}, ms);
		retry.addEventListener("click", () => location.reload());
		later(1200, () => hold.classList.add("is-visible"));
		later(10000, () => {
			retry.hidden = false;
		});
	});
})();
