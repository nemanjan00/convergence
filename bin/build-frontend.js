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
const outDir = path.join(root, "frontend", "dist");

const bundle = execSync(
	"npx esbuild frontend/entry.js --bundle --format=iife --minify",
	{ cwd: root, maxBuffer: 32 * 1024 * 1024 }
).toString();

// Use a pre-captured run if RESULT_JSON points at one (live export is slow);
// otherwise run the flow now.
const data = process.env.RESULT_JSON
	? fs.readFileSync(process.env.RESULT_JSON).toString()
	: execSync("node bin/export.js", { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString();

const css = fs.readFileSync(path.join(root, "frontend", "style.css")).toString();

// Escape any "</" so embedded JSON/JS can never break out of its <script>.
const safe = (text) => {
	return text.replace(/<\//g, "<\\/");
};

const html = "<style>\n" + css + "\n</style>\n" +
	"<script>window.__DATA__ = " + safe(data.trim()) + ";</script>\n" +
	"<script>" + safe(bundle) + "</script>\n";

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html);

console.log("wrote frontend/dist/index.html (" + html.length + " bytes)");
