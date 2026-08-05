// Run a flow (real sources + blocks, live network) and serialize the converged
// result — entities (fields + provenance), lineage edges, spec, and yaml — as
// JSON. This is the shape the data explorer / flow builder render.
//
// Run: yarn export [path/to/flow.yaml] > result.json

const fs = require("fs");
const path = require("path");
const loader = require("../src/loader");
const engineFactory = require("../src/engine");
const blocks = require("../src/blocks");
const sources = require("../src/sources");
const store = require("../src/services/store");
const journal = require("../src/services/journal");
const samples = require("../src/samples");

const flowPath = process.argv[2] ||
	path.join(__dirname, "../examples/flows/ct-recon.yaml");

const yamlString = fs.readFileSync(flowPath).toString("utf8");
const spec = loader.parse(yamlString);
const source = spec.sources[0];

const sourcePull = sources.pullFor(source.block, source.params) || (() => {
	return Promise.resolve([]);
});

const engine = engineFactory.create();
blocks.register(engine);

const flow = loader.load(yamlString, { sourcePull: sourcePull });

const serializeEntity = (entity) => {
	const fields = {};

	Object.keys(entity.fields).forEach((name) => {
		fields[name] = {
			value: entity.fields[name].value,
			block: entity.fields[name].provenance.block,
			at: entity.fields[name].provenance.at
		};
	});

	return { type: entity._type, key: entity._identity, version: entity._version, fields: fields };
};

engine.run(flow)
	.then(() => {
		const entities = {};

		Object.keys(flow.entities).forEach((type) => {
			entities[type] = store.all(type).map(serializeEntity);
		});

		process.stdout.write(JSON.stringify({
			flow: flow.name,
			yaml: yamlString,
			spec: loader.parse(yamlString),
			entities: entities,
			edges: store.edges(),
			executions: journal.all(),
			samples: samples.all()
		}, null, 2) + "\n");

		process.exit(0);
	})
	.catch((error) => {
		console.error("export failed:", error);
		process.exit(1);
	});
