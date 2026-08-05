// Runnable proof of the core bet: compose blocks, fan several enrichments into
// ONE host entity, each field carrying provenance. Offline + deterministic.
//
// Mirrors examples/flows/ct-recon.yaml. The YAML-to-flow loader (which compiles
// `{{ }}` templates and validates the spec) is a separate milestone; here the
// flow is built programmatically so the runtime can be exercised today.
//
// Run: yarn demo

const runtimeFactory = require("../src/runtime");
const demoBlocks = require("../src/blocks/demo");
const store = require("../src/services/store");

const runtime = runtimeFactory.create();

runtime.registerBlock("dns.a", demoBlocks.dnsA);
runtime.registerBlock("rdap", demoBlocks.rdap, { maxConcurrent: 5 });
runtime.registerBlock("port.scan", demoBlocks.nmap, { maxConcurrent: 10 });
runtime.registerBlock("http.title", demoBlocks.httpTitle);

const flow = {
	name: "ct-recon",
	entities: {
		host: { key: ["ip"], merge: "last-write-wins-with-provenance" }
	},
	source: {
		emits: "cert",
		pull: () => {
			return Promise.resolve([
				{ san: ["a.example.com"], is_precert: false },
				{ san: ["b.example.com"], is_precert: false }
			]);
		}
	},
	blocks: [
		{
			id: "resolve",
			uses: "dns.a",
			inputs: (ctx) => ({ name: ctx.cert.san[0] }),
			mergeInto: "host"
		},
		{
			id: "whois",
			uses: "rdap",
			inputs: (ctx) => ({ domain: ctx.cert.san[0] }),
			mergeInto: "host"
		},
		{
			id: "scan",
			uses: "port.scan",
			when: { "host.ip": { $ne: null } },
			inputs: (ctx) => ({ target: ctx.host.ip, args: "-sV --top-ports 100" }),
			mergeInto: "host"
		},
		{
			id: "title",
			uses: "http.title",
			when: { "host.open_ports": { $in: [80, 443] } },
			inputs: (ctx) => ({ url: "https://" + ctx.host.ip }),
			mergeInto: "host"
		}
	]
};

runtime.run(flow)
	.then(() => {
		const hosts = store.all("host");

		console.log("Produced " + hosts.length + " host entities:\n");

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

		// queue-promised keeps worker poll loops alive; a one-shot entrypoint
		// must exit explicitly. A long-running service would not.
		process.exit(0);
	})
	.catch((error) => {
		console.error("demo failed:", error);
		process.exit(1);
	});
