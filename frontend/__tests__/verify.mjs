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

const rows = document.querySelectorAll("tbody tr").length;
const tabs = document.querySelectorAll(".tab").length;
const hasHost = document.body.innerHTML.indexOf("a.example.com") !== -1;

const failures = [];
if (rows < 1) { failures.push("no table rows rendered"); }
if (tabs !== 2) { failures.push("expected 2 tabs, got " + tabs); }
if (!hasHost) { failures.push("host value not in DOM"); }

if (failures.length > 0) {
	console.error("FRONTEND RENDER FAILED:\n  - " + failures.join("\n  - "));
	process.exit(1);
}

console.log("frontend render OK — rows=" + rows + " tabs=" + tabs + " host=" + hasHost);
process.exit(0);
