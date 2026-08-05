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
				return { uses: block.uses, rate: block.rate || {} };
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
		const rows = store.all(opts.entityType).map(rowOf);
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

		return engine.run(flow).then(() => {
			const entities = {};

			Object.keys(flow.entities).forEach((type) => {
				entities[type] = store.all(type).map(rowOf);
			});

			return { flow: flow.name, entities: entities, edges: store.edges() };
		});
	}
};

module.exports = mcp;
