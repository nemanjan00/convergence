// Web entry (yarn web) — the real, long-running convergence app. It:
//   - hydrates prior state from Mongo (playbooks, journal, entities) if MONGO_URL,
//   - serves the HTTP API + the frontend bundle (src/api),
//   - runs a scheduler that converges every ACTIVE playbook on a cron, persisting
//     after each pass.
// This is the single stateful process the UI and the MCP server both talk to.

const cron = require("node-cron");
const createApp = require("./api").createApp;
const config = require("./config");
const loader = require("./loader");
const store = require("./services/store");
const journal = require("./services/journal");
const playbooks = require("./services/playbooks");
const mcp = require("./mcp");
const persistenceFactory = require("./services/persistence");

const PORT = Number(config.get("PORT")) || 3000;
const schedule = config.get("MONITOR_CRON") || "*/15 * * * *";
const mongoUrl = config.get("MONGO_URL");
const persistence = mongoUrl ? persistenceFactory(mongoUrl, config.get("MONGO_DB")) : null;

// Entity defs (type -> {key, fields}) across all playbooks, so persistence can
// define the collections before loading stored entities into them.
const collectEntityDefs = () => {
	const defs = {};

	playbooks.all().forEach((book) => {
		try {
			const spec = loader.parse(book.yaml);
			Object.assign(defs, spec.entities || {});
		} catch {
			// skip an unparseable draft
		}
	});

	return defs;
};

// One scheduler tick: converge every active playbook (shared store accumulates),
// record each outcome, persist. Tolerant per-playbook.
const tick = () => {
	const active = playbooks.active();

	return active.reduce((chain, book) => {
		return chain.then(() => {
			return mcp.runFlow(book.yaml)
				.then((result) => {
					const counts = {};
					Object.keys(result.entities || {}).forEach((type) => { counts[type] = result.entities[type].length; });
					playbooks.recordRun(book.id, counts);
				})
				.catch((error) => { playbooks.recordRun(book.id, { error: error.message }); });
		});
	}, Promise.resolve()).then(() => {
		if (!persistence) { return null; }

		return Promise.all([
			persistence.save(store, Object.keys(store._collections)),
			persistence.saveJournal(journal),
			persistence.savePlaybooks(playbooks)
		]);
	});
};

const hydrate = persistence
	? persistence.loadPlaybooks(playbooks)
		.then(() => { return persistence.loadJournal(journal); })
		.then(() => { return persistence.load(store, collectEntityDefs()); })
	: Promise.resolve();

hydrate.then(() => {
	const app = createApp();

	app.listen(PORT, () => {
		console.log("convergence API + UI on http://localhost:" + PORT);
		console.log("persistence: " + (persistence ? mongoUrl : "off (in-memory only)"));
		console.log("scheduler: active playbooks on '" + schedule + "'");
	});

	if (cron.validate(schedule)) {
		cron.schedule(schedule, tick);
	}
}).catch((error) => {
	console.error("failed to start:", error);
	process.exit(1);
});
