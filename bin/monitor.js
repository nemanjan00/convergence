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
const playbooks = require("../src/services/playbooks");
const config = require("../src/config");
const persistenceFactory = require("../src/services/persistence");

const DEFAULT_CRON = "*/15 * * * *";

// Two modes: `--playbooks` runs every ACTIVE playbook each tick (the play/pause
// runtime); otherwise monitor a single flow file (default ct-recon).
const playbookMode = process.argv[2] === "--playbooks";
const flowPath = (!playbookMode && process.argv[2]) ||
	path.join(__dirname, "../examples/flows/ct-recon.yaml");

const schedule = config.get("MONITOR_CRON") || DEFAULT_CRON;
const mongoUrl = config.get("MONGO_URL");
const persistence = mongoUrl ? persistenceFactory(mongoUrl, config.get("MONGO_DB")) : null;

// Converge one flow YAML once: hydrate prior state, run, persist. Returns a
// per-type before->after count. Tolerant callers wrap failures.
const runFlowYaml = (yamlString) => {
	const spec = loader.parse(yamlString);
	const source = spec.sources[0];
	const sourcePull = sources.pullFor(source.block, source.params) || (() => { return Promise.resolve([]); });

	const engine = engineFactory.create();
	blocks.register(engine);

	const flow = loader.load(yamlString, { sourcePull: sourcePull });

	const hydrate = persistence
		? persistence.load(store, flow.entities).then(() => { return persistence.loadJournal(journal); })
		: Promise.resolve();

	const started = {};

	return hydrate
		.then(() => {
			Object.keys(flow.entities).forEach((type) => { started[type] = store.all(type).length; });

			return engine.run(flow);
		})
		.then(() => { return persistence ? persistence.save(store, Object.keys(flow.entities)) : null; })
		.then(() => { return persistence ? persistence.saveJournal(journal) : null; })
		.then(() => {
			const counts = {};
			Object.keys(flow.entities).forEach((type) => {
				counts[type] = { before: started[type], after: store.all(type).length };
			});

			return { flow: flow.name, counts: counts };
		});
};

// Single-flow tick.
const runOnce = () => {
	return runFlowYaml(fs.readFileSync(flowPath).toString("utf8"))
		.then((result) => {
			const summary = Object.keys(result.counts).map((type) => {
				return type + " " + result.counts[type].before + "->" + result.counts[type].after;
			}).join(", ");

			console.log(new Date().toISOString() + "  tick ok — " + summary);
		})
		.catch((error) => {
			console.error(new Date().toISOString() + "  tick FAILED:", error && error.message ? error.message : error);
		});
};

// Playbook tick: re-load the registry (so activate/pause from elsewhere takes
// effect), run every ACTIVE playbook, record each outcome. One failing playbook
// never stops the others or the schedule.
const runActivePlaybooks = () => {
	const load = persistence ? persistence.loadPlaybooks(playbooks) : Promise.resolve();

	return load.then(() => {
		const active = playbooks.active();

		if (active.length === 0) {
			console.log(new Date().toISOString() + "  tick — no active playbooks");
			return null;
		}

		// Sequential so runs don't stomp the shared in-memory store mid-tick.
		return active.reduce((chain, book) => {
			return chain.then(() => {
				return runFlowYaml(book.yaml)
					.then((result) => {
						playbooks.recordRun(book.id, result.counts);
						console.log(new Date().toISOString() + "  " + book.name + " ok");
					})
					.catch((error) => {
						playbooks.recordRun(book.id, { error: error.message });
						console.error(new Date().toISOString() + "  " + book.name + " FAILED:", error.message);
					});
			});
		}, Promise.resolve()).then(() => {
			return persistence ? persistence.savePlaybooks(playbooks) : null;
		});
	});
};

const tick = playbookMode ? runActivePlaybooks : runOnce;

console.log("Monitoring " + (playbookMode ? "ACTIVE PLAYBOOKS" : "'" + flowPath + "'") + " on '" + schedule + "'");
console.log("Persistence: " + (persistence ? mongoUrl : "off (each tick is fresh — set MONGO_URL to accumulate)") + "\n");

if (!cron.validate(schedule)) {
	console.error("invalid MONITOR_CRON: " + schedule);
	process.exit(1);
}

// Run one tick immediately, then on the schedule.
tick();
cron.schedule(schedule, tick);
