// The AI-facing capability layer — parity with the flow-builder/CLI, exposed
// over MCP (bin/mcp.mjs). Inspired by the Trickest SDK's shape: a tool "library"
// (blocks), "runs" (execute a flow), and a "database" query over entities in the
// same Mongo-style dialect (sift) the flow guards use. Pure and testable; the
// MCP server is thin glue on top.

const sift = require("sift").default;
const blocks = require("../blocks");
const sources = require("../sources");
const loader = require("../loader");
const engineFactory = require("../engine");
const store = require("../services/store");
const playbookRegistry = require("../services/playbooks");

// Serialize an entity to a flat row with underscore-prefixed system fields
// (mirrors the Trickest Live Tables shape).
const rowOf = (entity) => {
	const row = { _key: entity._identity, _version: entity._version };

	Object.keys(entity.fields).forEach((name) => {
		row[name] = entity.fields[name].value;
	});

	return row;
};

const mcp = {
	// The tool library: which blocks and sources a flow may use.
	listBlocks: () => {
		return {
			blocks: blocks.all().map((block) => {
				return { uses: block.uses, rate: block.rate || {}, describe: block.describe || "", example: block.example || null };
			}),
			sources: sources.all().map((source) => {
				return { source: source.source };
			})
		};
	},

	// Validate a flow YAML against the contract.
	validateFlow: (yamlString) => {
		try {
			const spec = loader.parse(yamlString);
			const errors = loader.validate(spec);

			return { valid: errors.length === 0, errors: errors };
		} catch (error) {
			return { valid: false, errors: [error.message] };
		}
	},

	// Query entities from the current store with a sift (Mongo-style) filter —
	// the TQL/Live-Tables analog. Returns a { columns, rows, row_count } table.
	queryEntities: (args) => {
		const opts = args || {};
		// Scope to one playbook when asked (its own entity namespace); otherwise
		// query the raw store (bare types, all playbooks).
		const db = opts.playbook ? store.scope(opts.playbook) : store;
		const rows = db.all(opts.entityType).map(rowOf);
		const predicate = opts.query ? sift(opts.query) : () => true;
		const matched = rows.filter(predicate);

		let projected = matched;

		if (Array.isArray(opts.select) && opts.select.length > 0) {
			projected = matched.map((row) => {
				const out = {};

				opts.select.forEach((column) => {
					if (column in row) {
						out[column] = row[column];
					}
				});

				return out;
			});
		}

		const limited = opts.limit ? projected.slice(0, opts.limit) : projected;

		return {
			columns: limited.length > 0 ? Object.keys(limited[0]) : [],
			rows: limited,
			row_count: limited.length,
			total_count: matched.length
		};
	},

	// Execute a flow to convergence (live). Returns entities (as rows) + edges.
	// options.sourcePull overrides the source (used in tests to stay offline).
	runFlow: (yamlString, options) => {
		const opts = options || {};
		const spec = loader.parse(yamlString);
		const source = spec.sources[0];
		const pull = opts.sourcePull ||
			sources.pullFor(source.block, source.params) ||
			(() => { return Promise.resolve([]); });

		const engine = engineFactory.create();
		blocks.register(engine);

		const flow = loader.load(yamlString, { sourcePull: pull });

		// Tag the run with its playbook so journal entries can be re-run later, and
		// so the store namespaces this flow's entities to it (no cross-bleed).
		if (opts.playbookId) { flow._playbook = opts.playbookId; }

		const db = store.scope(flow._playbook);

		return engine.run(flow).then(() => {
			const entities = {};

			Object.keys(flow.entities).forEach((type) => {
				entities[type] = db.all(type).map(rowOf);
			});

			return { flow: flow.name, entities: entities, edges: db.edges() };
		});
	},

	// --- Playbook management (draft/active/paused lifecycle) ----------------

	// List playbooks (id, name, state, validity — not the full YAML).
	listPlaybooks: () => {
		return {
			playbooks: playbookRegistry.all().map((book) => {
				return {
					id: book.id, name: book.name, state: book.state,
					schedule: book.schedule, valid: book.valid,
					updated_at: book.updated_at, last_run_at: book.last_run_at
				};
			})
		};
	},

	// Get one playbook in full (incl. YAML + validation errors).
	getPlaybook: (id) => {
		return playbookRegistry.get(id);
	},

	// Create or update a playbook. With `id` it patches; without, it creates a
	// new draft. Returns the stored playbook (with { valid, errors }).
	savePlaybook: (args) => {
		const opts = args || {};

		if (opts.id && playbookRegistry.get(opts.id)) {
			return playbookRegistry.update(opts.id, { name: opts.name, yaml: opts.yaml, schedule: opts.schedule });
		}

		return playbookRegistry.create(opts);
	},

	// Transition a playbook: draft | active | paused. Activating an invalid
	// playbook is refused.
	setPlaybookState: (id, state) => {
		try {
			return playbookRegistry.setState(id, state);
		} catch (error) {
			return { error: error.message };
		}
	},

	// Re-run a single execution (the Executions "re-run"): resolve the flow from
	// the entry's originating playbook, then re-run that block against that
	// entity. The re-run itself is journaled (a fresh execution). Returns
	// { ran, changed } or { error }.
	rerunExecution: (entry) => {
		if (!entry || !entry.playbook || !entry.entity) {
			return Promise.resolve({ error: "execution has no playbook context to re-run from" });
		}

		const book = playbookRegistry.get(entry.playbook);

		if (!book) {
			return Promise.resolve({ error: "playbook not found: " + entry.playbook });
		}

		const engine = engineFactory.create();
		blocks.register(engine);

		const flow = loader.load(book.yaml, { sourcePull: () => { return Promise.resolve([]); } });
		flow._playbook = book.id;

		return engine.runBlockById(flow, entry.block, entry.entity.type, entry.entity.key)
			.catch((error) => { return { ran: false, error: error.message }; });
	},

	// Export a playbook as a portable artifact (name/schedule/yaml).
	exportPlaybook: (id) => {
		return playbookRegistry.export(id);
	},

	// Import a portable artifact (or a bare flow YAML string) as a new draft.
	importPlaybook: (payload) => {
		return playbookRegistry.import(payload);
	}
};

module.exports = mcp;
