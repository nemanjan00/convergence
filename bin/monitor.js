// Monitor a flow OVER TIME. Re-runs a flow on a cron schedule; because
// persistence accumulates entities across runs and the execution journal records
// every run, this is how you watch a target change (a new subdomain appears, a
// port opens, a cert nears expiry) — and, with a webhook block in the flow, get
// alerted the moment convergence discovers it.
//
// The scheduler is the "tick" the user asked about: the engine itself runs to a
// fixpoint and exits, so periodic monitoring is a loop AROUND run(), not inside
// it. Pair with source.tick when the flow's subject is the clock.
//
// Run: yarn monitor [path/to/flow.yaml]   (schedule via MONITOR_CRON, default 15m)
// Needs MONGO_URL set to actually accumulate across ticks (else each run is fresh).

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const loader = require("../src/loader");
const engineFactory = require("../src/engine");
const blocks = require("../src/blocks");
const sources = require("../src/sources");
const store = require("../src/services/store");
const journal = require("../src/services/journal");
const config = require("../src/config");
const persistenceFactory = require("../src/services/persistence");

const DEFAULT_CRON = "*/15 * * * *";

const flowPath = process.argv[2] ||
	path.join(__dirname, "../examples/flows/ct-recon.yaml");

const schedule = config.get("MONITOR_CRON") || DEFAULT_CRON;
const mongoUrl = config.get("MONGO_URL");
const persistence = mongoUrl ? persistenceFactory(mongoUrl, config.get("MONGO_DB")) : null;

const yamlString = fs.readFileSync(flowPath).toString("utf8");

// One monitoring tick: hydrate prior state, converge, persist. Each tick is
// self-contained and tolerant so a single failure doesn't kill the schedule.
const runOnce = () => {
	const spec = loader.parse(yamlString);
	const source = spec.sources[0];
	const sourcePull = sources.pullFor(source.block, source.params) || (() => { return Promise.resolve([]); });

	const engine = engineFactory.create();
	blocks.register(engine);

	const flow = loader.load(yamlString, { sourcePull: sourcePull });

	const hydrate = persistence
		? persistence.load(store, flow.entities).then(() => { return persistence.loadJournal(journal); })
		: Promise.resolve();

	const startedEntities = {};

	return hydrate
		.then(() => {
			Object.keys(flow.entities).forEach((type) => { startedEntities[type] = store.all(type).length; });

			return engine.run(flow);
		})
		.then(() => {
			return persistence ? persistence.save(store, Object.keys(flow.entities)) : null;
		})
		.then(() => {
			return persistence ? persistence.saveJournal(journal) : null;
		})
		.then(() => {
			const summary = Object.keys(flow.entities).map((type) => {
				return type + " " + startedEntities[type] + "->" + store.all(type).length;
			}).join(", ");

			console.log(new Date().toISOString() + "  tick ok — " + summary);
		})
		.catch((error) => {
			console.error(new Date().toISOString() + "  tick FAILED:", error && error.message ? error.message : error);
		});
};

console.log("Monitoring '" + flowPath + "' on '" + schedule + "'");
console.log("Persistence: " + (persistence ? mongoUrl : "off (each tick is fresh — set MONGO_URL to accumulate)") + "\n");

if (!cron.validate(schedule)) {
	console.error("invalid MONITOR_CRON: " + schedule);
	process.exit(1);
}

// Run one tick immediately, then on the schedule.
runOnce();
cron.schedule(schedule, runOnce);
