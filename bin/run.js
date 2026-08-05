// Run a flow FROM ITS YAML on the convergence engine — the contract, end to end.
// Loads and validates examples/flows/ct-recon.yaml, binds a (fake, offline) CT
// source and the blocks, and converges it to a fixpoint.
//
// The same YAML the AI / flow-builder produce is what runs. Blocks fire by
// entity-state convergence, not authored order.
//
// Run: yarn flow  (or: node bin/run.js [path/to/flow.yaml])

const fs = require("fs");
const path = require("path");
const loader = require("../src/loader");
const engineFactory = require("../src/engine");
const demoBlocks = require("../src/blocks/demo");
const fanout = require("../src/blocks/fanout");
const store = require("../src/services/store");

const flowPath = process.argv[2] ||
	path.join(__dirname, "../examples/flows/ct-recon.yaml");

const yamlString = fs.readFileSync(flowPath).toString("utf8");

// A stand-in CT-log firehose: certs (one multi-SAN, one pre-cert to be filtered).
const fakeCtSource = () => {
	return Promise.resolve([
		{ id: 1, san: ["a.example.com"], is_precert: false },
		{ id: 2, san: ["b.example.com", "www.b.example.com"], is_precert: false },
		{ id: 3, san: ["precert.example.com"], is_precert: true }
	]);
};

const engine = engineFactory.create();
engine.registerBlock("fanout", fanout.handler);
engine.registerBlock("dns.a", demoBlocks.dnsA);
engine.registerBlock("rdap", demoBlocks.rdap, { maxConcurrent: 5 });
engine.registerBlock("port.scan", demoBlocks.nmap, { maxConcurrent: 10 });
engine.registerBlock("http.title", demoBlocks.httpTitle);

const flow = loader.load(yamlString, { sourcePull: fakeCtSource });

console.log("Loaded and validated flow: " + flow.name);
console.log("Source '" + flow.source.id + "' (" + flow.source.block + ") emits " + flow.source.emits);
console.log("Blocks: " + flow.blocks.map((block) => {
	return block.id;
}).join(", ") + "\n");

engine.run(flow)
	.then(() => {
		const hosts = store.all("host");

		console.log("Converged to " + hosts.length + " host entities:\n");

		hosts.forEach((host) => {
			console.log("host " + host._identity);

			Object.keys(host.fields).forEach((name) => {
				const field = host.fields[name];

				console.log(
					"  " + name + " = " + JSON.stringify(field.value) +
					"   (from block: " + field.provenance.block + ")"
				);
			});

			console.log("");
		});

		// queue-promised keeps worker loops alive; a one-shot entrypoint exits.
		process.exit(0);
	})
	.catch((error) => {
		console.error("flow run failed:", error);
		process.exit(1);
	});
