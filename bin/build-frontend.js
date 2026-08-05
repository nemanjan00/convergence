// Assemble the self-contained frontend page: esbuild-bundle the qrp app, run a
// flow to get real data, inline both plus the stylesheet into one HTML file.
// Output is content-only (no <html>/<head>/<body>) so it doubles as an Artifact
// body; a served build can wrap it.
//
// Run: yarn frontend:build  ->  frontend/dist/index.html

const fs = require("fs");
const path = require("path");
const execSync = require("child_process").execSync;

const root = path.join(__dirname, "..");
const outFile = process.env.OUT
	? path.resolve(root, process.env.OUT)
	: path.join(root, "frontend", "dist", "index.html");
const outDir = path.dirname(outFile);

const bundle = execSync(
	"npx esbuild frontend/entry.js --bundle --format=iife --minify",
	{ cwd: root, maxBuffer: 32 * 1024 * 1024 }
).toString();

const css = fs.readFileSync(path.join(root, "frontend", "style.css")).toString();

// Use a pre-captured run if RESULT_JSON points at one (live export is slow);
// otherwise run the flow now. LIVE_ONLY skips the baked artifact entirely (the
// served app only needs live.html, which fetches /api/snapshot).
const data = process.env.LIVE_ONLY
	? null
	: (process.env.RESULT_JSON
		? fs.readFileSync(process.env.RESULT_JSON).toString()
		: execSync("node bin/export.js", { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString());

// Escape any "</" so embedded JSON/JS can never break out of its <script>.
const safe = (text) => {
	return text.replace(/<\//g, "<\\/");
};

const styleTag = "<style>\n" + css + "\n</style>\n";
const bundleTag = "<script>" + safe(bundle) + "</script>\n";

fs.mkdirSync(outDir, { recursive: true });

// Static artifact: data baked in as window.__DATA__ (skipped for LIVE_ONLY).
if (data !== null) {
	const html = styleTag + "<script>window.__DATA__ = " + safe(data.trim()) + ";</script>\n" + bundleTag;

	fs.writeFileSync(outFile, html);
	console.log("wrote " + outFile + " (" + html.length + " bytes)");
}

// Live page for the served app: no baked data, so entry.js fetches
// /api/snapshot. Wrapped in a minimal document since it isn't an Artifact body.
const live = "<!doctype html>\n<html><head><meta charset=\"utf-8\">" +
	"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
	"<title>convergence</title>\n" + styleTag + "</head><body>\n" + bundleTag + "</body></html>\n";
const liveFile = path.join(outDir, "live.html");
fs.writeFileSync(liveFile, live);
console.log("wrote " + liveFile + " (" + live.length + " bytes)");
