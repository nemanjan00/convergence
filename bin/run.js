// Execute a flow FROM ITS YAML — the contract, end to end. Loads and validates
// examples/flows/ct-recon.yaml, binds a (fake, offline) CT-log source and the
// demo blocks, and runs it through the deterministic runtime.
//
// This is the payoff of the loader: the same YAML the AI/flow-builder produce is
// what runs. Run: yarn flow  (or: node bin/run.js [path/to/flow.yaml])

const fs = require("fs");
const path = require("path");
const loader = require("../src/loader");
const runtimeFactory = require("../src/runtime");
const demoBlocks = require("../src/blocks/demo");
const store = require("../src/services/store");

const flowPath = process.argv[2] ||
	path.join(__dirname, "../examples/flows/ct-recon.yaml");

const yamlString = fs.readFileSync(flowPath).toString("utf8");

// A stand-in CT-log firehose: a handful of certs, one a pre-cert that the
// flow's `filter: { cert.is_precert: false }` should drop.
const fakeCtSource = () => {
	return Promise.resolve([
		{ san: ["a.example.com"], is_precert: false },
		{ san: ["b.example.com"], is_precert: false },
		{ san: ["precert.example.com"], is_precert: true }
	]);
};

const runtime = runtimeFactory.create();
runtime.registerBlock("dns.a", demoBlocks.dnsA);
runtime.registerBlock("rdap", demoBlocks.rdap, { maxConcurrent: 5 });
runtime.registerBlock("port.scan", demoBlocks.nmap, { maxConcurrent: 10 });
runtime.registerBlock("http.title", demoBlocks.httpTitle);

const flow = loader.load(yamlString, { sourcePull: fakeCtSource });

console.log("Loaded and validated flow: " + flow.name);
console.log("Source '" + flow.source.id + "' (" + flow.source.block + ") emits " + flow.source.emits);
console.log("Blocks: " + flow.blocks.map((block) => {
	return block.id;
}).join(" -> ") + "\n");

runtime.run(flow)
	.then(() => {
		const hosts = store.all("host");

		console.log("Produced " + hosts.length + " host entities (pre-cert filtered out):\n");

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

		process.exit(0);
	})
	.catch((error) => {
		console.error("flow run failed:", error);
		process.exit(1);
	});
