const root = document.documentElement;
try {
	const stored = localStorage.getItem("milu.site.theme");
	if (stored === "light" || stored === "dark") root.dataset.theme = stored;
} catch {}
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
document.querySelector(".theme-btn")?.addEventListener("click", () => {
	const active = root.dataset.theme ?? (prefersDark.matches ? "dark" : "light");
	root.dataset.theme = active === "dark" ? "light" : "dark";
	try {
		localStorage.setItem("milu.site.theme", root.dataset.theme);
	} catch {}
});

const nav = document.querySelector(".nav");
const foot = document.querySelector(".foot");
const toTop = document.querySelector(".to-top");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const onScroll = () => {
	nav?.classList.toggle("is-scrolled", window.scrollY > 8);
	const atFoot = foot ? foot.getBoundingClientRect().top < window.innerHeight - 16 : false;
	toTop?.classList.toggle("is-visible", window.scrollY > 600 && !atFoot);
};
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);

toTop?.addEventListener("click", (event) => {
	event.preventDefault();
	window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
	history.replaceState(null, "", `${location.pathname}${location.search}`);
});
