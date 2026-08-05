// Run a flow FROM ITS YAML on the convergence engine, against REAL sources and
// blocks (live network). Loads + validates the flow, binds the source from the
// sources registry, registers the built-in blocks, and converges to a fixpoint.
//
// Run: yarn flow  (or: node bin/run.js [path/to/flow.yaml])

const fs = require("fs");
const path = require("path");
const loader = require("../src/loader");
const engineFactory = require("../src/engine");
const blocks = require("../src/blocks");
const sources = require("../src/sources");
const store = require("../src/services/store");
const config = require("../src/config");
const persistenceFactory = require("../src/services/persistence");

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

// Persistence is opt-in via MONGO_URL. When set, hydrate prior state before the
// run and save after — so runs accumulate durably.
const mongoUrl = config.get("MONGO_URL");
const persistence = mongoUrl ? persistenceFactory(mongoUrl, config.get("MONGO_DB")) : null;

console.log("Loaded and validated flow: " + flow.name);
console.log("Source '" + flow.source.id + "' (" + flow.source.block + ") emits " + flow.source.emits);
console.log("Blocks: " + flow.blocks.map((b) => b.id).join(", "));
console.log("Persistence: " + (persistence ? mongoUrl : "off (in-memory)") + "\n");
console.log("converging (live)…\n");

const hydrate = persistence ? persistence.load(store, flow.entities) : Promise.resolve();

hydrate
	.then(() => {
		return engine.run(flow);
	})
	.then(() => {
		return persistence ? persistence.save(store, Object.keys(flow.entities)) : null;
	})
	.then(() => {
		return persistence ? persistence.close() : null;
	})
	.then(() => {
		Object.keys(flow.entities).forEach((type) => {
			const list = store.all(type);
			console.log("== " + type + " (" + list.length + ") ==");

			list.forEach((entity) => {
				console.log(entity._identity);

				Object.keys(entity.fields).forEach((name) => {
					const field = entity.fields[name];
					console.log("  " + name + " = " + JSON.stringify(field.value) +
						"   (" + field.provenance.block + ")");
				});
			});

			console.log("");
		});

		const edges = store.edges();
		console.log("Lineage edges (" + edges.length + "):");
		edges.forEach((edge) => {
			console.log("  " + edge.from.type + " " + edge.from.key + "  --" + edge.rel +
				"-->  " + edge.to.type + " " + edge.to.key);
		});

		process.exit(0);
	})
	.catch((error) => {
		console.error("flow run failed:", error);
		process.exit(1);
	});
