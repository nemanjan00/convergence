// Headless render check for the qrp frontend — no browser needed. Registers a
// happy-dom document, renders app.js, and drives the two-level UX (home list ->
// open a playbook -> its data views), asserting the DOM came out right.
//
// Run: node frontend/__tests__/verify.mjs

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// The qrp router needs a real browser history; under happy-dom drive navigation
// through the reactive state path instead (same code the router calls).
window.__NO_ROUTER__ = true;

const app = await import("../app.js");

const data = {
	flow: "ct-recon",
	yaml: "apiVersion: v0\nkind: Flow\nmetadata:\n  name: ct-recon\n",
	spec: {
		sources: [{ id: "ct", block: "source.ct-log", emits: "cert" }],
		blocks: [
			{ id: "fanout", uses: "fanout", for_each: "cert", merge_into: "host", relation: "has_san" },
			{ id: "resolve", uses: "dns.a", for_each: "host", merge_into: "host" }
		],
		entities: { cert: { key: ["id"] }, host: { key: ["name"] } }
	},
	entities: {
		host: [
			{ type: "host", key: "name=\"a.example.com\"", version: 3, fields: { name: { value: "a.example.com", block: "fanout" }, ip: { value: "1.2.3.4", block: "resolve" } } },
			{ type: "host", key: "name=\"b.example.com\"", version: 2, fields: { name: { value: "b.example.com", block: "fanout" } } }
		],
		cert: [ { type: "cert", key: "id=1", version: 1, fields: { id: { value: 1, block: "ct" } } } ],
		// A phantom from ANOTHER playbook — must never surface in pb-1's workspace.
		leak: [ { type: "leak", key: "ip=\"1.1.1.1\"", version: 1, playbook: "other-pb", fields: { ip: { value: "1.1.1.1", block: "x" } } } ]
	},
	edges: [ { from: { type: "cert", key: "id=1" }, rel: "has_san", to: { type: "host", key: "name=\"a.example.com\"" }, via: "fanout" } ],
	// executions carry the playbook id (pb-1) so they scope to it on the page.
	executions: [
		{ id: "x1", playbook: "pb-1", sweep: 1, block: "fanout", uses: "fanout", entity: { type: "cert", key: "id=1" }, status: "ok", changed: true, input: { certificate: "…" }, output: [{ name: "a.example.com" }], duration_ms: 3 },
		{ id: "x2", playbook: "pb-1", sweep: 2, block: "resolve", uses: "dns.a", entity: { type: "host", key: "name=\"a.example.com\"" }, status: "ok", changed: true, input: { name: "a.example.com" }, output: { ip: "1.2.3.4" }, duration_ms: 12 },
		{ id: "x3", playbook: "pb-1", sweep: 2, block: "resolve", uses: "dns.a", entity: { type: "host", key: "name=\"b.example.com\"" }, status: "skipped", changed: false }
	],
	playbooks: [ { id: "pb-1", name: "ct-recon", state: "active", valid: true, schedule: null, last_run_at: null, yaml: "apiVersion: v0\nkind: Flow\nmetadata:\n  name: ct-recon\n" } ],
	samples: [ { name: "ct-recon", description: "CT recon sample", yaml: "apiVersion: v0\nkind: Flow\nmetadata:\n  name: ct-recon\n" } ],
	library: { blocks: [{ uses: "http.title" }, { uses: "dns.a" }, { uses: "tls.cert" }, { uses: "log", describe: "debug passthrough" }], sources: [{ source: "source.ct-log" }] }
};

const failures = [];
const q = (sel) => Array.from(document.querySelectorAll(sel));
const click = (node) => node.dispatchEvent(new window.Event("click", { bubbles: true }));
const navByText = (text) => q(".nav-item").find((n) => n.textContent.indexOf(text) !== -1);

// --- HOME (all playbooks) ---
app.render(document.body, data);

if (q(".pbcard").length < 1) { failures.push("home: no playbook cards"); }
if (!navByText("Playbooks")) { failures.push("home: no Playbooks nav item"); }
if (navByText("Entities")) { failures.push("home: data-view nav should NOT appear before opening a playbook"); }

// sample import adds a card (local mode)
const chip = q(".chip").find((c) => c.textContent.indexOf("ct-recon") !== -1);
if (!chip) {
	failures.push("home: no sample-import chip");
} else {
	const before = q(".pbcard").length;
	click(chip);
	if (q(".pbcard").length !== before + 1) { failures.push("home: importing a sample did not add a card"); }
}

// activating a draft opens a confirmation MODAL (not window.confirm)
const activateBtn = q(".pbcard .actions button").find((b) => /activate/i.test(b.textContent));
if (activateBtn) {
	click(activateBtn);
	if (!document.querySelector(".modal-backdrop")) { failures.push("activate did not open a modal"); }
	const confirmBtn = q(".modal .btn-accent")[0];
	if (confirmBtn) { click(confirmBtn); }
	if (document.querySelector(".modal-backdrop")) { failures.push("modal did not close after confirm"); }
}

// --- open the first playbook -> full re-render to the PLAYBOOK PAGE ---
click(q(".pbcard")[0]);

["Overview", "Entities", "Graph", "Executions", "Flow"].forEach((label) => {
	if (!navByText(label)) { failures.push("playbook page: missing nav '" + label + "'"); }
});
if (!navByText("All playbooks")) { failures.push("playbook page: no back link"); }

// overview: state pill + a deliberate activate/pause action
if (q("[class*='pill-pb-']").length < 1) { failures.push("overview: no state pill"); }
if (!q(".actions button").find((b) => /activate|pause/i.test(b.textContent))) {
	failures.push("overview: no explicit activate/pause action");
}

// --- Flow (builder) ---
click(navByText("Flow"));
const nodes = q(".gnode").length;
const wires = q("svg.wires path.wire").length;
if (nodes !== 5) { failures.push("builder: expected 5 nodes, got " + nodes); }
if (wires !== 4) { failures.push("builder: expected 4 wires, got " + wires); }

// double-click a block -> MODAL editor
document.querySelector(".gnode.block").dispatchEvent(new window.Event("dblclick", { bubbles: true }));
const formFields = q(".modal .editor .field").length;
if (formFields < 7) { failures.push("builder: modal editor did not render, fields=" + formFields); }

const relationInput = q(".modal .editor .field")
	.map((f) => ({ label: f.querySelector("label").textContent, input: f.querySelector("input") }))
	.find((f) => f.label === "relation").input;
relationInput.value = "verified_edit";
relationInput.dispatchEvent(new window.Event("input", { bubbles: true }));
if (document.querySelector("pre.yaml").textContent.indexOf("verified_edit") === -1) {
	failures.push("builder: modal edit did not round-trip into YAML");
}
// close the modal (Done)
const done = q(".modal .btn-accent").find((b) => b.textContent === "Done");
if (done) { click(done); }
if (q(".modal .editor").length !== 0) { failures.push("builder: modal did not close"); }

// palette: adding a block adds a node to the canvas + lands in the YAML
const palItem = q(".pal-item").find((b) => b.textContent.indexOf("tls.cert") !== -1);
if (!palItem) {
	failures.push("builder: tls.cert palette item not rendered");
} else {
	const beforeNodes = q(".gnode").length;
	click(palItem);
	if (q(".gnode").length <= beforeNodes) { failures.push("builder: adding a palette block did not add a node"); }
	if (document.querySelector("pre.yaml").textContent.indexOf("tls.cert") === -1) {
		failures.push("builder: added block not reflected in YAML");
	}
}

// explicit save (no autosave): a Save button exists, and editing marks it dirty
if (!q(".save-bar button").some((b) => /save/i.test(b.textContent))) {
	failures.push("builder: no explicit Save flow button");
}
if (q(".save-bar .dirty").length < 1) {
	failures.push("builder: editing did not mark the flow dirty (unsaved)");
}

// no overlap in the builder layout
const boxes = q(".gnode").map((n) => {
	const s = n.getAttribute("style") || "";
	const left = Number((s.match(/left:\s*(-?[\d.]+)px/) || [])[1]);
	const top = Number((s.match(/top:\s*(-?[\d.]+)px/) || [])[1]);
	return { left, top, right: left + 184, bottom: top + 62 };
});
let overlaps = 0;
boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
	const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
	if (!apart) { overlaps = overlaps + 1; }
}));
if (overlaps > 0) { failures.push("builder: " + overlaps + " overlapping node pair(s)"); }
if (new Set(boxes.map((b) => b.left)).size < 2) { failures.push("builder: nodes not spread across layers"); }

// --- Graph ---
click(navByText("Graph"));
if (q(".gnode.ent").length < 1) { failures.push("graph: no entity nodes"); }

// --- Entities (explorer) — type groups at top, drill lineage, detail, table ---
click(navByText("Entities"));
if (q(".tnode.tgroup").length < 1) { failures.push("explorer tree: no type groups at top level"); }
// every entity type should appear as a top-level group (incl. child-only types)
if (!q(".tnode.tgroup .tbadge").some((b) => b.textContent === "host")) {
	failures.push("explorer tree: 'host' type not shown at top level");
}
// per-playbook scoping: a 'leak' entity tagged to ANOTHER playbook must not show
if (q(".tnode.tgroup .tbadge").some((b) => b.textContent === "leak")) {
	failures.push("scoping: an entity from another playbook bled into this one");
}
// expand an entity that has lineage children
const caret = q(".tnode:not(.tgroup) .caret").find((c) => c.textContent === "▸");
if (caret) {
	const before = q(".tnode").length;
	click(caret);
	if (q(".tnode").length <= before) { failures.push("explorer tree: expanding an entity revealed no children"); }
}
// select an ENTITY (not a group) -> detail shows its fields
click(q(".tnode:not(.tgroup) .tlabel")[0]);
if (q(".detail .dfield").length < 1) { failures.push("explorer: selecting a node showed no fields"); }
// table toggle
const tableSeg = q(".seg-btn").find((b) => b.textContent === "table");
if (tableSeg) { click(tableSeg); if (q("tbody tr").length < 1) { failures.push("explorer table: no rows"); } }

// --- Executions (scoped to this playbook) ---
click(navByText("Executions"));
if (q("tbody tr").length < 1) { failures.push("executions: no rows"); }
if (q(".pill").length < 1) { failures.push("executions: no status pills"); }
click(q("tbody tr.row")[0]);
const detailText = document.querySelector(".lineage") ? document.querySelector(".lineage").textContent : "";
if (detailText.indexOf("input") === -1 || detailText.indexOf("output") === -1) {
	failures.push("executions: selecting a run did not show input/output");
}

// --- phone: open a playbook, go to Flow, confirm vertical + no overlap ---
window.innerWidth = 390;
document.body.innerHTML = "";
app.render(document.body, data);
click(q(".pbcard")[0]);
click(navByText("Flow"));
const nboxes = q(".gnode").map((n) => {
	const s = n.getAttribute("style") || "";
	const left = Number((s.match(/left:\s*(-?[\d.]+)px/) || [])[1]);
	const top = Number((s.match(/top:\s*(-?[\d.]+)px/) || [])[1]);
	return { left, top, right: left + 184, bottom: top + 62 };
});
let noverlaps = 0;
nboxes.forEach((a, i) => nboxes.slice(i + 1).forEach((b) => {
	const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
	if (!apart) { noverlaps = noverlaps + 1; }
}));
if (noverlaps > 0) { failures.push("narrow: " + noverlaps + " overlapping node pair(s)"); }
if (new Set(nboxes.map((b) => b.top)).size < 2) { failures.push("narrow: nodes not stacked vertically"); }

if (failures.length > 0) {
	console.error("FRONTEND RENDER FAILED:\n  - " + failures.join("\n  - "));
	process.exit(1);
}

console.log("frontend OK — two-level nav: home(list) -> open -> playbook page(overview/entities/graph/executions/flow); nodes=" +
	nodes + " wires=" + wires + " form=" + formFields);
process.exit(0);
