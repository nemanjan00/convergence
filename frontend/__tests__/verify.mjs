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
blockNode.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));

const formFields = document.querySelectorAll(".editor .field").length;

const relationInput = Array.from(document.querySelectorAll(".editor .field")).map((f) => {
	return { label: f.querySelector("label").textContent, input: f.querySelector("input") };
}).find((f) => f.label === "relation").input;

relationInput.value = "verified_edit";
relationInput.dispatchEvent(new window.Event("input", { bubbles: true }));

const yamlText = document.querySelector("pre.yaml").textContent;

const failures = [];
if (rows < 1) { failures.push("no table rows rendered"); }
if (tabs !== 3) { failures.push("expected 3 tabs, got " + tabs); }
if (!hasHost) { failures.push("host value not in DOM"); }
if (nodes !== 5) { failures.push("expected 5 canvas nodes, got " + nodes); }
if (wires !== 4) { failures.push("expected 4 wires (in-place enrichment = 1 wire), got " + wires); }
if (formFields < 7) { failures.push("editor form did not render, fields=" + formFields); }
if (yamlText.indexOf("verified_edit") === -1) { failures.push("block edit did not round-trip into YAML"); }

// Switch to the discovery graph and check nodes + edges render.
const graphTab = Array.from(document.querySelectorAll(".tab"))
	.find((t) => t.textContent === "Graph");
graphTab.click();

const graphNodes = document.querySelectorAll(".gnode.ent").length;
if (graphNodes < 1) { failures.push("graph rendered no entity nodes"); }

if (failures.length > 0) {
	console.error("FRONTEND RENDER FAILED:\n  - " + failures.join("\n  - "));
	process.exit(1);
}

console.log("frontend OK — rows=" + rows + " tabs=" + tabs + " nodes=" + nodes +
	" wires=" + wires + " form=" + formFields + " edit round-trip=yes");
process.exit(0);
