// Flow loader: turn the contract YAML (docs/FLOW_SPEC.md) into a validated,
// runtime-ready flow. This is where the written contract becomes executable.
//
//   const flow = loader.load(yamlString, { sourcePull });
//   runtime.run(flow);
//
// parse -> validate (collect every error) -> compile (templates + shape the
// runtime consumes). The AI/flow-builder emit YAML; nothing here executes it.

const yaml = require("js-yaml");
const template = require("../utils/template");

const SUPPORTED_API = "v0";

// Detect a cycle in the ENTITY-TYPE graph: each block adds an edge
// for_each -> merge_into. A self-loop (a block that reads and writes the same
// entity type — ordinary in-place enrichment like scan/title on `host`) is NOT
// a cycle. A real cycle is cross-type: A reads X writes Y while B reads Y writes
// X, which cannot converge. Returns true if any such cycle exists.
const hasCycle = (spec) => {
	const blocks = spec.blocks || [];

	// edges: entityType -> [entityType]
	const edges = {};

	blocks.forEach((block) => {
		if (block.for_each === block.merge_into) {
			return; // self-loop: legitimate in-place enrichment
		}

		edges[block.for_each] = edges[block.for_each] || [];

		if (edges[block.for_each].indexOf(block.merge_into) === -1) {
			edges[block.for_each].push(block.merge_into);
		}
	});

	const state = {}; // undefined | "visiting" | "done"

	const visit = (type) => {
		if (state[type] === "visiting") {
			return true;
		}

		if (state[type] === "done") {
			return false;
		}

		state[type] = "visiting";

		const cycle = (edges[type] || []).some((next) => {
			return visit(next);
		});

		state[type] = "done";

		return cycle;
	};

	return Object.keys(edges).some((type) => {
		return visit(type);
	});
};

const loader = {
	parse: (yamlString) => {
		return yaml.load(yamlString);
	},

	// Return an array of human-readable error strings ([] means valid).
	validate: (spec) => {
		const errors = [];

		if (!spec || typeof spec !== "object") {
			return ["flow is empty or not an object"];
		}

		if (spec.apiVersion !== SUPPORTED_API) {
			errors.push("unsupported apiVersion: " + spec.apiVersion + " (want " + SUPPORTED_API + ")");
		}

		if (!spec.metadata || !spec.metadata.name) {
			errors.push("metadata.name is required");
		}

		const entities = spec.entities || {};
		const sources = spec.sources || [];
		const blocks = spec.blocks || [];

		if (Object.keys(entities).length === 0) {
			errors.push("at least one entity type must be declared");
		}

		Object.keys(entities).forEach((type) => {
			if (!Array.isArray(entities[type].key) || entities[type].key.length === 0) {
				errors.push("entity '" + type + "' needs a non-empty key array");
			}
		});

		// Unique ids across sources and blocks.
		const ids = {};
		sources.concat(blocks).forEach((node) => {
			if (node.id === undefined) {
				errors.push("every source/block needs an id");
				return;
			}

			if (ids[node.id]) {
				errors.push("duplicate id: " + node.id);
			}

			ids[node.id] = true;
		});

		// Types that can be produced (source emits + block merge_into).
		const producible = {};
		sources.forEach((source) => {
			if (source.emits) {
				producible[source.emits] = true;
			}
		});
		blocks.forEach((block) => {
			if (block.merge_into) {
				producible[block.merge_into] = true;
			}
		});

		sources.forEach((source) => {
			if (!source.block) {
				errors.push("source '" + source.id + "' needs a block");
			}

			if (!source.emits) {
				errors.push("source '" + source.id + "' needs emits");
			}

			if (source.filter !== undefined && (typeof source.filter !== "object" || Array.isArray(source.filter))) {
				errors.push("source '" + source.id + "' filter must be a query object");
			}
		});

		blocks.forEach((block) => {
			if (!block.uses) {
				errors.push("block '" + block.id + "' needs uses");
			}

			if (!block.merge_into) {
				errors.push("block '" + block.id + "' needs merge_into");
			} else if (!entities[block.merge_into]) {
				errors.push("block '" + block.id + "' merge_into '" + block.merge_into + "' is not a declared entity");
			}

			if (!block.for_each) {
				errors.push("block '" + block.id + "' needs for_each");
			} else if (!producible[block.for_each]) {
				errors.push("block '" + block.id + "' for_each '" + block.for_each + "' is never produced by a source or block");
			}

			if (block.when !== undefined && (typeof block.when !== "object" || Array.isArray(block.when))) {
				errors.push("block '" + block.id + "' when must be a query object");
			}

			// Template paths must be syntactically valid.
			if (block.inputs) {
				try {
					template.compileInputs(block.inputs);
				} catch (error) {
					errors.push("block '" + block.id + "' has " + error.message);
				}
			}
		});

		if (blocks.length > 0 && hasCycle(spec)) {
			errors.push("flow graph contains a cycle");
		}

		return errors;
	},

	// Compile a (assumed valid) spec into the object src/runtime consumes.
	// options.sourcePull: () => Promise<item[]> bound to the single source.
	compile: (spec, options) => {
		const opts = options || {};
		const entities = {};

		Object.keys(spec.entities).forEach((type) => {
			entities[type] = {
				key: spec.entities[type].key,
				merge: spec.entities[type].merge || "last-write-wins-with-provenance"
			};
		});

		const blocks = (spec.blocks || []).map((block) => {
			return {
				id: block.id,
				uses: block.uses,
				forEach: block.for_each,
				when: block.when,
				inputs: template.compileInputs(block.inputs || {}),
				mergeInto: block.merge_into,
				rate: block.rate,
				trace: []
			};
		});

		const source = spec.sources[0];

		return {
			name: spec.metadata.name,
			entities: entities,
			source: {
				id: source.id,
				block: source.block,
				emits: source.emits,
				filter: source.filter,
				pull: opts.sourcePull || (() => {
					return Promise.resolve([]);
				})
			},
			blocks: blocks
		};
	},

	// Convenience: parse + validate (throw on errors) + compile.
	load: (yamlString, options) => {
		const spec = loader.parse(yamlString);
		const errors = loader.validate(spec);

		if (errors.length > 0) {
			throw new Error("invalid flow:\n  - " + errors.join("\n  - "));
		}

		return loader.compile(spec, options);
	}
};

module.exports = loader;
