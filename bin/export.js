// Run a flow and serialize the converged result — entities (fields +
// provenance) and lineage edges — as JSON. This is the shape the data explorer
// (and any UI) renders. Backend-only, no rendering here.
//
// Run: yarn export [path/to/flow.yaml] > result.json

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

// Serialize an entity to a plain, UI-friendly shape.
const serializeEntity = (entity) => {
	const fields = {};

	Object.keys(entity.fields).forEach((name) => {
		fields[name] = {
			value: entity.fields[name].value,
			block: entity.fields[name].provenance.block,
			at: entity.fields[name].provenance.at
		};
	});

	return {
		type: entity._type,
		key: entity._identity,
		version: entity._version,
		fields: fields
	};
};

engine.run(flow)
	.then(() => {
		const entities = {};

		Object.keys(flow.entities).forEach((type) => {
			entities[type] = store.all(type).map(serializeEntity);
		});

		const result = {
			flow: flow.name,
			yaml: yamlString,
			spec: loader.parse(yamlString),
			entities: entities,
			edges: store.edges()
		};

		process.stdout.write(JSON.stringify(result, null, 2) + "\n");
		process.exit(0);
	})
	.catch((error) => {
		console.error("export failed:", error);
		process.exit(1);
	});
