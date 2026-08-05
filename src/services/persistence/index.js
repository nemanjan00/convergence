// Mongo persistence for the entity store. The engine works on the fast
// in-memory store per run; this layer HYDRATES prior state before a run and
// SAVES after, so runs accumulate durably (an entity keeps growing across
// runs). Entities and edges are keyed deterministically, so re-saving merges.
//
// This is the working-set-in-memory / durable-in-Mongo shape. A fully
// Mongo-native store (query millions of entities directly, the explorer's data
// source) is the scale path — same collections, same sift dialect.

const MongoClient = require("mongodb").MongoClient;

const DEFAULT_DB = "convergence";

const edgeId = (edge) => {
	return [edge.from.type, edge.from.key, edge.rel, edge.to.type, edge.to.key].join("|");
};

module.exports = (mongoUrl, dbName) => {
	const persistence = {
		_client: undefined,

		_db: () => {
			if (!persistence._client) {
				persistence._client = new MongoClient(mongoUrl);
			}

			return persistence._client.connect().then((client) => {
				return client.db(dbName || DEFAULT_DB);
			});
		},

		// Upsert every entity of the given types + all edges. Deterministic _ids
		// mean a re-save merges rather than duplicates.
		save: (store, types) => {
			return persistence._db().then((db) => {
				const ops = [];

				types.forEach((type) => {
					store.all(type).forEach((entity) => {
						ops.push(db.collection("entities").updateOne(
							{ _id: entity._type + "|" + entity._identity },
							{ $set: {
								type: entity._type,
								key: entity._identity,
								version: entity._version,
								fields: entity.fields
							} },
							{ upsert: true }
						));
					});
				});

				store.edges().forEach((edge) => {
					ops.push(db.collection("edges").updateOne(
						{ _id: edgeId(edge) },
						{ $set: edge },
						{ upsert: true }
					));
				});

				return Promise.all(ops);
			});
		},

		// Define the entity types, then load persisted entities + edges into the
		// store (before a run, so the run builds on prior state).
		load: (store, entityDefs) => {
			Object.keys(entityDefs).forEach((type) => {
				store.define(type, entityDefs[type]);
			});

			return persistence._db().then((db) => {
				return db.collection("entities").find({}).toArray().then((docs) => {
					docs.forEach((doc) => {
						const collection = store._collections[doc.type];

						if (collection) {
							collection.byIdentity[doc.key] = {
								_type: doc.type,
								_identity: doc.key,
								_version: doc.version,
								fields: doc.fields
							};
						}
					});

					return db.collection("edges").find({}).toArray();
				}).then((edges) => {
					edges.forEach((edge) => {
						store.addEdge({ from: edge.from, rel: edge.rel, to: edge.to, via: edge.via, at: edge.at });
					});
				});
			});
		},

		// Append this run's execution journal to the durable `executions`
		// collection (keyed by entry id, so a re-save is idempotent). This is how
		// logs survive restarts — the panel reads the accumulated history.
		saveJournal: (journal) => {
			const entries = journal.all();

			if (entries.length === 0) {
				return Promise.resolve();
			}

			return persistence._db().then((db) => {
				const ops = entries.map((entry) => {
					return db.collection("executions").updateOne(
						{ _id: entry.id },
						{ $set: entry },
						{ upsert: true }
					);
				});

				return Promise.all(ops);
			});
		},

		// Load prior executions into the journal before a run, so the panel shows
		// history across runs (most-recent cap applied by the journal itself).
		loadJournal: (journal) => {
			return persistence._db().then((db) => {
				return db.collection("executions").find({}).toArray().then((docs) => {
					journal.hydrate(docs);
				});
			});
		},

		close: () => {
			if (!persistence._client) {
				return Promise.resolve();
			}

			return persistence._client.close();
		}
	};

	return persistence;
};
