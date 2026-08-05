// Headless render check for the qrp frontend — no browser needed. Registers a
// happy-dom document, renders app.js with sample data, and asserts the DOM came
// out right. This is how the frontend is verified in CI-like conditions.
//
// Run: node frontend/__tests__/verify.mjs

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// Import qrp + app AFTER the DOM globals exist.
const app = await import("../app.js");

const data = {
	flow: "ct-recon",
	yaml: "apiVersion: v0\nkind: Flow\n",
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
			{
				type: "host", key: "name=\"a.example.com\"", version: 3,
				fields: {
					name: { value: "a.example.com", block: "fanout" },
					ip: { value: "1.2.3.4", block: "resolve" }
				}
			},
			{
				type: "host", key: "name=\"b.example.com\"", version: 2,
				fields: { name: { value: "b.example.com", block: "fanout" } }
			}
		],
		cert: [
			{ type: "cert", key: "id=1", version: 1, fields: { id: { value: 1, block: "ct" } } }
		]
	},
	edges: [
		{ from: { type: "cert", key: "id=1" }, rel: "has_san", to: { type: "host", key: "name=\"a.example.com\"" }, via: "fanout" }
	],
	executions: [
		{ id: "x1", run: "r", sweep: 1, block: "fanout", uses: "fanout", entity: { type: "cert", key: "id=1" }, status: "ok", changed: true, outputs: 2, input: { certificate: "…" }, output: [{ name: "a.example.com" }], duration_ms: 3 },
		{ id: "x2", run: "r", sweep: 2, block: "resolve", uses: "dns.a", entity: { type: "host", key: "name=\"a.example.com\"" }, status: "ok", changed: true, input: { name: "a.example.com" }, output: { ip: "1.2.3.4" }, duration_ms: 12 },
		{ id: "x3", run: "r", sweep: 2, block: "resolve", uses: "dns.a", entity: { type: "host", key: "name=\"b.example.com\"" }, status: "skipped", changed: false }
	],
	samples: [
		{ name: "ct-recon", description: "CT recon sample", yaml: "apiVersion: v0\nkind: Flow\nmetadata:\n  name: ct-recon\n" }
	]
};

app.render(document.body, data);

// Explorer (default view)
const rows = document.querySelectorAll("tbody tr").length;
const tabs = document.querySelectorAll(".tab").length;
const hasHost = document.body.innerHTML.indexOf("a.example.com") !== -1;

// Switch to the flow builder and check the node canvas rendered.
const builderTab = Array.from(document.querySelectorAll(".tab"))
	.find((t) => t.textContent.indexOf("builder") !== -1);
builderTab.click();

// nodes = 1 source + 2 entities + 2 blocks = 5.
// wires: source->cert (1) + fanout: cert->fanout + fanout->host (derivation, 2)
//        + resolve: host->resolve (in-place, 1 input wire only) = 4.
const nodes = document.querySelectorAll(".gnode").length;
const wires = document.querySelectorAll("svg.wires path.wire").length;

// Editing: select a block, confirm the form renders, edit `relation`, and
// confirm the live YAML round-trips the change.
const blockNode = document.querySelector(".gnode.block");
blockNode.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));

const formFields = document.querySelectorAll(".editor .field").length;

// Layered placement: the builder nodes must not overlap (that is the whole
// point of the layout algorithm) and must occupy more than one column (i.e. the
// layers actually spread along the flow direction, not one big pile).
const boxes = Array.from(document.querySelectorAll(".gnode")).map((n) => {
	const style = n.getAttribute("style") || "";
	const left = Number((style.match(/left:\s*(-?[\d.]+)px/) || [])[1]);
	const top = Number((style.match(/top:\s*(-?[\d.]+)px/) || [])[1]);
	return { left: left, top: top, right: left + 184, bottom: top + 62 };
});

let overlaps = 0;
boxes.forEach((a, i) => {
	boxes.slice(i + 1).forEach((b) => {
		const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
		if (!apart) { overlaps = overlaps + 1; }
	});
});

const columns = new Set(boxes.map((b) => b.left)).size;

const relationInput = Array.from(document.querySelectorAll(".editor .field")).map((f) => {
	return { label: f.querySelector("label").textContent, input: f.querySelector("input") };
}).find((f) => f.label === "relation").input;

relationInput.value = "verified_edit";
relationInput.dispatchEvent(new window.Event("input", { bubbles: true }));

const yamlText = document.querySelector("pre.yaml").textContent;

const failures = [];
if (rows < 1) { failures.push("no table rows rendered"); }
if (tabs !== 5) { failures.push("expected 5 tabs, got " + tabs); }
if (!hasHost) { failures.push("host value not in DOM"); }
if (nodes !== 5) { failures.push("expected 5 canvas nodes, got " + nodes); }
if (wires !== 4) { failures.push("expected 4 wires (in-place enrichment = 1 wire), got " + wires); }
if (formFields < 7) { failures.push("editor form did not render, fields=" + formFields); }
if (overlaps > 0) { failures.push("layout produced " + overlaps + " overlapping node pair(s)"); }
if (columns < 2) { failures.push("layout did not spread nodes across layers (columns=" + columns + ")"); }
if (yamlText.indexOf("verified_edit") === -1) { failures.push("block edit did not round-trip into YAML"); }

// Switch to the discovery graph and check nodes + edges render.
const graphTab = Array.from(document.querySelectorAll(".tab"))
	.find((t) => t.textContent === "Graph");
graphTab.click();

const graphNodes = document.querySelectorAll(".gnode.ent").length;
if (graphNodes < 1) { failures.push("graph rendered no entity nodes"); }

// Executions panel: switch to it, confirm the run log rendered a row per
// execution with status pills, and that selecting one shows its input/output.
const execTab = Array.from(document.querySelectorAll(".tab"))
	.find((t) => t.textContent.indexOf("Executions") !== -1);
execTab.click();

const execRows = document.querySelectorAll("tbody tr").length;
const pills = document.querySelectorAll(".pill").length;
if (execRows !== 3) { failures.push("executions: expected 3 rows, got " + execRows); }
if (pills !== 3) { failures.push("executions: expected 3 status pills, got " + pills); }

document.querySelector("tbody tr.row").click();
const detailText = document.querySelector(".lineage") ? document.querySelector(".lineage").textContent : "";
if (detailText.indexOf("input") === -1 || detailText.indexOf("output") === -1) {
	failures.push("executions: selecting a run did not show input/output");
}

// Playbooks: switch, confirm a row + a lifecycle pill render, and that cycling
// the state changes the pill class (draft -> active -> paused).
const pbTab = Array.from(document.querySelectorAll(".tab"))
	.find((t) => t.textContent.indexOf("Playbooks") !== -1);
pbTab.click();

const pbRows = document.querySelectorAll("tbody tr.row").length;
const statePill = document.querySelector("[class*='pill-pb-']");
if (pbRows < 1) { failures.push("playbooks: no rows rendered"); }
if (!statePill) { failures.push("playbooks: no lifecycle pill rendered"); }

// A sample-import chip should render and, when clicked, add a playbook row.
const sampleChip = Array.from(document.querySelectorAll(".chip")).find((c) => c.textContent.indexOf("ct-recon") !== -1);
if (!sampleChip) {
	failures.push("playbooks: no sample-import chip rendered");
} else {
	const before = document.querySelectorAll("tbody tr.row").length;
	sampleChip.dispatchEvent(new window.Event("click", { bubbles: true }));
	if (document.querySelectorAll("tbody tr.row").length !== before + 1) {
		failures.push("playbooks: importing a sample did not add a row");
	}
}
if (statePill) {
	const before = statePill.getAttribute("class");
	statePill.dispatchEvent(new window.Event("click", { bubbles: true }));
	const afterPill = document.querySelector("[class*='pill-pb-']");
	if (afterPill && afterPill.getAttribute("class") === before) {
		failures.push("playbooks: state pill did not cycle on click");
	}
}

// Phone orientation: render fresh at a narrow width and confirm the layout
// flips to vertical (nodes stack down, not across) and still never overlaps.
window.innerWidth = 390;
document.body.innerHTML = "";
app.render(document.body, data);

Array.from(document.querySelectorAll(".tab"))
	.find((t) => t.textContent.indexOf("builder") !== -1)
	.click();

const nboxes = Array.from(document.querySelectorAll(".gnode")).map((n) => {
	const style = n.getAttribute("style") || "";
	const left = Number((style.match(/left:\s*(-?[\d.]+)px/) || [])[1]);
	const top = Number((style.match(/top:\s*(-?[\d.]+)px/) || [])[1]);
	return { left: left, top: top, right: left + 184, bottom: top + 62 };
});

let noverlaps = 0;
nboxes.forEach((a, i) => {
	nboxes.slice(i + 1).forEach((b) => {
		const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
		if (!apart) { noverlaps = noverlaps + 1; }
	});
});

const nrows = new Set(nboxes.map((b) => b.top)).size;
if (noverlaps > 0) { failures.push("narrow layout produced " + noverlaps + " overlapping node pair(s)"); }
if (nrows < 2) { failures.push("narrow layout did not stack nodes vertically (rows=" + nrows + ")"); }

if (failures.length > 0) {
	console.error("FRONTEND RENDER FAILED:\n  - " + failures.join("\n  - "));
	process.exit(1);
}

console.log("frontend OK — rows=" + rows + " tabs=" + tabs + " nodes=" + nodes +
	" wires=" + wires + " form=" + formFields + " edit round-trip=yes");
process.exit(0);
