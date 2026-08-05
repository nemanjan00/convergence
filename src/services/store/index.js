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

// How merge conflicts resolve when two blocks write the same field.
const MERGE_STRATEGIES = {
	// Later provenance timestamp wins on a genuine value change. A write that
	// repeats the existing value is a no-op that PRESERVES the original
	// provenance — the block that first established a fact keeps the credit
	// (this is what stops identity re-seeding from stealing provenance).
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

	// Register an entity type with its identity key and merge strategy. Mirrors
	// the `entities:` block of a flow YAML.
	define: (entityType, options) => {
		const opts = options || {};

		store._collections[entityType] = {
			keyFields: opts.key || ["id"],
			strategy: opts.merge || "last-write-wins-with-provenance",
			byIdentity: {}
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
			fields: {}
		};

		// Build the next entity without mutating the existing one.
		const nextFields = Object.assign({}, existing.fields);

		Object.keys(fields).forEach((name) => {
			const incoming = {
				value: fields[name],
				provenance: provenance
			};

			nextFields[name] = merge(existing.fields[name], incoming);
		});

		const merged = {
			_type: entityType,
			_identity: identity,
			fields: nextFields
		};

		collection.byIdentity[identity] = merged;

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

	// Test/demo helper: forget everything.
	_reset: () => {
		store._collections = {};

		return store;
	}
};

module.exports = store;
