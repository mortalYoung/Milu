import { normalize, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..", "site");
const port = Number(process.env.PORT ?? 4173);

const TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};

const server = Bun.serve({
	port,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		const target = resolve(root, `.${normalize(path === "/" ? "/index.html" : path)}`);
		if (!target.startsWith(root + sep)) return new Response("not found", { status: 404 });
		const file = Bun.file(target);
		if (!(await file.exists())) return new Response("not found", { status: 404 });
		const type = TYPES[target.slice(target.lastIndexOf("."))] ?? "application/octet-stream";
		return new Response(file, { headers: { "content-type": type } });
	},
});

console.log(`site: http://127.0.0.1:${server.port}`);
