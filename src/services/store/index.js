// Entity store — the moat. Blocks contribute fields to entities; this module
// merges them into a single document keyed by identity, attaching provenance to
// EVERY field so we can always answer "where did this claim come from?".
//
// Named for what it does (store entities), not how (mongo). This first
// implementation is in-memory so the demo runs with no database.
//
// TODO(mongo): swap the in-memory `_collections` map for a real Mongo cluster
//   (config MONGO_URL / MONGO_DB). The public surface (upsert/get/all) is the
//   contract the rest of the system depends on and must not change.

// Structural value equality — good enough for the JSON-shaped values blocks
// produce (strings, numbers, arrays, plain objects).
const valuesEqual = (a, b) => {
	return JSON.stringify(a) === JSON.stringify(b);
};

const asArray = (value) => {
	return Array.isArray(value) ? value : [value];
};

// A merge strategy returns the SAME field object on a no-op (so the entity
// version does not move and the fixpoint terminates), or a new field object on
// a real change. See docs/DATA_MODEL.md.
const MERGE_STRATEGIES = {
	// Monotonic (DEFAULT). First value sticks; later writes are ignored. Scalars
	// stay scalars. Convergence is guaranteed (a field, once set, never moves).
	"first-write-wins-with-provenance": (existing, incoming) => {
		if (!existing) {
			return incoming;
		}

		return existing;
	},

	// Monotonic. Field is a set; new distinct values are appended. For fields
	// that accumulate (observed ports, resolved ips). Grows monotonically, so it
	// terminates.
	"union-with-provenance": (existing, incoming) => {
		const incomingValues = asArray(incoming.value);

		if (!existing) {
			return { value: incomingValues, provenance: incoming.provenance };
		}

		const current = asArray(existing.value);
		const merged = current.slice();

		incomingValues.forEach((value) => {
			const present = merged.some((have) => {
				return valuesEqual(have, value);
			});

			if (!present) {
				merged.push(value);
			}
		});

		if (merged.length === current.length) {
			return existing; // nothing new — no-op
		}

		return { value: merged, provenance: existing.provenance };
	},

	// NON-monotonic (available, but flagged). Newer timestamp wins on a real
	// change; can oscillate if two blocks fight over one field. MAX_SWEEPS in the
	// engine is the only backstop.
	"last-write-wins-with-provenance": (existing, incoming) => {
		if (!existing) {
			return incoming;
		}

		if (valuesEqual(existing.value, incoming.value)) {
			return existing;
		}

		if (incoming.provenance.at >= existing.provenance.at) {
			return incoming;
		}

		return existing;
	}
};

const DEFAULT_STRATEGY = "first-write-wins-with-provenance";

// Compute an entity's identity key from its key fields (e.g. ["ip"]).
const identityOf = (keyFields, fields) => {
	return keyFields
		.map((name) => {
			return name + "=" + JSON.stringify(fields[name]);
		})
		.join("&");
};

const store = {
	// entityType -> identity -> { fields: {name: {value, provenance}}, ... }
	_collections: {},

	// Lineage edges between entities (parent --rel--> child). First-class, kept
	// separate from field provenance. See docs/DATA_MODEL.md.
	_edges: [],

	// Register an entity type with its identity key and merge strategy. Mirrors
	// the `entities:` block of a flow YAML. Defaults to the monotonic
	// first-write-wins strategy so convergence is guaranteed.
	define: (entityType, options) => {
		const opts = options || {};
		const existing = store._collections[entityType];

		store._collections[entityType] = {
			keyFields: opts.key || ["id"],
			strategy: opts.merge || DEFAULT_STRATEGY,
			// Field type hints. An entry with `links` auto-materializes a linked
			// entity + edge when that field is written (typed fields build the
			// graph). See docs/DATA_MODEL.md.
			fieldLinks: opts.fields || {},
			// Preserve already-loaded entities so hydrating from Mongo before a
			// run survives the engine re-defining the type (runs accumulate).
			byIdentity: existing ? existing.byIdentity : {}
		};

		return store;
	},

	// Merge a block result's fields into the matching entity, stamping the
	// result's provenance onto each field. Returns the merged entity.
	upsert: (entityType, fields, provenance) => {
		const collection = store._collections[entityType];

		if (!collection) {
			throw new Error("unknown entity type: " + entityType);
		}

		const merge = MERGE_STRATEGIES[collection.strategy];
		const identity = identityOf(collection.keyFields, fields);
		const existing = collection.byIdentity[identity] || {
			_type: entityType,
			_identity: identity,
			_version: 0,
			fields: {}
		};

		// Build the next entity without mutating the existing one. Track whether
		// anything actually changed — the convergence engine uses `_version` to
		// know when an entity settled (a no-op write keeps the same field object,
		// so the version does not move and the fixpoint terminates).
		const nextFields = Object.assign({}, existing.fields);
		const changedFields = {};
		let changed = false;

		Object.keys(fields).forEach((name) => {
			const incoming = {
				value: fields[name],
				provenance: provenance
			};

			const nextField = merge(existing.fields[name], incoming);

			if (nextField !== existing.fields[name]) {
				changed = true;
				changedFields[name] = true;
			}

			nextFields[name] = nextField;
		});

		const merged = {
			_type: entityType,
			_identity: identity,
			_version: changed ? existing._version + 1 : existing._version,
			fields: nextFields
		};

		collection.byIdentity[identity] = merged;

		// Typed-field auto-linking: a changed field with a `links` hint
		// materializes the linked entity (keyed by its value) and records an
		// edge. This is how typed fields build the entity graph.
		Object.keys(changedFields).forEach((name) => {
			const spec = collection.fieldLinks[name];

			if (!spec || !spec.links) {
				return;
			}

			const targetType = spec.links;
			const targetKey = spec.as || name;
			const rel = spec.rel || name;
			const raw = fields[name];
			const values = Array.isArray(raw) ? raw : [raw];

			values.forEach((value) => {
				if (value === null || value === undefined) {
					return;
				}

				const seed = {};
				seed[targetKey] = value;

				const target = store.upsert(targetType, seed, provenance);

				store.addEdge({
					from: { type: entityType, key: identity },
					rel: rel,
					to: { type: targetType, key: target._identity },
					via: provenance.block,
					at: provenance.at
				});
			});
		});

		return merged;
	},

	// Fetch one entity by its already-computed identity.
	get: (entityType, identity) => {
		const collection = store._collections[entityType];

		if (!collection) {
			return null;
		}

		return collection.byIdentity[identity] || null;
	},

	// All entities of a type, as an array.
	all: (entityType) => {
		const collection = store._collections[entityType];

		if (!collection) {
			return [];
		}

		return Object.keys(collection.byIdentity).map((identity) => {
			return collection.byIdentity[identity];
		});
	},

	// Same as all(), but keyed by identity — the map-getter companion the
	// house style asks for alongside every array getter.
	allMap: (entityType) => {
		const map = {};

		store.all(entityType).forEach((entity) => {
			map[entity._identity] = entity;
		});

		return map;
	},

	// Record a lineage edge parent --rel--> child (deduped). Called by the engine
	// on every derivation.
	addEdge: (edge) => {
		const exists = store._edges.some((have) => {
			return have.from.type === edge.from.type &&
				have.from.key === edge.from.key &&
				have.rel === edge.rel &&
				have.to.type === edge.to.type &&
				have.to.key === edge.to.key;
		});

		if (!exists) {
			store._edges.push(edge);
		}

		return store;
	},

	// All edges (optionally filtered by from/to type+key).
	edges: (filter) => {
		const f = filter || {};

		return store._edges.filter((edge) => {
			if (f.fromType && edge.from.type !== f.fromType) {
				return false;
			}

			if (f.fromKey && edge.from.key !== f.fromKey) {
				return false;
			}

			if (f.toType && edge.to.type !== f.toType) {
				return false;
			}

			if (f.toKey && edge.to.key !== f.toKey) {
				return false;
			}

			return true;
		});
	},

	// Test/demo helper: forget everything.
	_reset: () => {
		store._collections = {};
		store._edges = [];

		return store;
	}
};

module.exports = store;
