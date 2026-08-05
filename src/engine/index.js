// The convergence engine: the deterministic executor. The AI composes a flow;
// this runs it to a FIXPOINT. It is entity-state-driven: a block re-evaluates
// its `when` guard against the CURRENT state of each entity and runs whenever it
// matches — regardless of which block produced the triggering fact ("port 50
// open" can arrive a million ways; the reaction fires on the data, not the
// source). Sweeps repeat until no entity changes: that is convergence.
//
// This is a separate, self-contained module (engine) so it can evolve
// independently of blocks, stdlib, and helpers. It shares only the store, the
// block-contract envelope, and config.
//
// TODO(streaming): this in-memory fixpoint is the semantic reference. The
// unbounded streaming substrate (per-edge bounded queues, week-long runs,
// restart-resume) converges to the same fixpoint incrementally.

const wrapper = require("queue-promised").wrapper;
const uuid = require("uuid").v4;
const sift = require("sift").default;
const config = require("../config");
const store = require("../services/store");
const journal = require("../services/journal");
const envelope = require("../utils/envelope");

// Safety backstop: a well-formed flow settles; a misbehaving block that never
// stops changing a value (e.g. a timestamp) would otherwise loop forever.
const MAX_SWEEPS = 100;

// Flatten a stored entity ({name:{value,provenance}}) to {name:value} so guards
// and input resolvers read `host.ip` naturally.
const flattenEntity = (entity) => {
	const flat = {};

	Object.keys(entity.fields).forEach((name) => {
		flat[name] = entity.fields[name].value;
	});

	return flat;
};

// Keep the target entity keyed consistently: carry its identity fields into
// every merge.
const identityValues = (keyFields, flat) => {
	const seed = {};

	keyFields.forEach((name) => {
		if (flat[name] !== undefined) {
			seed[name] = flat[name];
		}
	});

	return seed;
};

// The store this flow works against: namespaced to its playbook so a playbook's
// entities never merge with another's (see store.scope). A flow with no
// `_playbook` (bare CLI/demo runs) uses the unscoped store.
const storeFor = (flow) => {
	return store.scope(flow._playbook);
};

// A block's `when` guard is a Mongo-style query (sift) over the entity context.
const passesWhen = (when, ctx) => {
	if (!when) {
		return true;
	}

	return sift(when)(ctx);
};

const createEngine = () => {
	const engine = {
		_blocks: {},

		// Register a block: name + handler(input) => Promise<fields>. Rate limits
		// are enforced here by the engine, never inside the handler.
		registerBlock: (name, handler, options) => {
			const opts = options || {};
			const queueOptions = {
				count: opts.maxConcurrent || config.getNumber("DEFAULT_MAX_CONCURRENT")
			};

			if (opts.maxPerMin) {
				queueOptions.minTime = Math.ceil(60000 / opts.maxPerMin);
			}

			engine._blocks[name] = {
				name: name,
				call: wrapper(handler, queueOptions)
			};

			return engine;
		},

		// Run one block against one entity, if its guard matches. Merges any
		// produced fields into the target entity with provenance. Returns true
		// if the target entity actually changed.
		_apply: (flow, block, entity, seen) => {
			const db = storeFor(flow);
			const ctx = {};
			ctx[block.forEach] = flattenEntity(entity);

			// Parent references: the entities THIS one was derived from (lineage
			// edges pointing at it), exposed in the context so `inputs`/`when`/
			// `filter` can read an ancestor's fields — e.g. on a host a cert
			// produced, `{{ cert.issuer }}` / `when: { "cert.issuer": … }`. The
			// first parent of each type wins; all are under `_parents`.
			const parentEdges = db.edges({ toType: block.forEach, toKey: entity._identity });

			if (parentEdges.length > 0) {
				const parents = [];

				parentEdges.forEach((edge) => {
					const parent = db.get(edge.from.type, edge.from.key);

					if (!parent) { return; }

					const flat = flattenEntity(parent);
					flat._type = edge.from.type;
					flat._rel = edge.rel;
					parents.push(flat);

					if (ctx[edge.from.type] === undefined) { ctx[edge.from.type] = flat; }
				});

				if (parents.length > 0) { ctx._parents = parents; }
			}

			// Base journal fields shared by every outcome for this attempt.
			const logBase = {
				run: flow._runId,
				sweep: flow._sweep,
				playbook: flow._playbook || null,
				block: block.id,
				uses: block.uses,
				for_each: block.forEach,
				merge_into: block.mergeInto,
				entity: { type: block.forEach, key: entity._identity }
			};

			if (!passesWhen(block.when, ctx)) {
				journal.record(Object.assign({ status: "skipped", changed: false }, logBase));

				return Promise.resolve(false);
			}

			const registered = engine._blocks[block.uses];

			if (!registered) {
				return Promise.reject(new Error("unknown block: " + block.uses));
			}

			const work = envelope.makeWorkItem({
				flow: flow.name,
				run: flow._runId,
				block: block.id,
				item_id: uuid(),
				trace: [block.forEach + ":" + entity._identity],
				input: block.inputs(ctx)
			});

			const startedAt = Date.now();

			return registered.call(work.input).then((output) => {
				const collection = flow.entities[block.mergeInto];

				// Keep merges keyed: seed identity from the target's current state
				// (the triggering entity when merging into its own type).
				const currentTarget = (block.mergeInto === block.forEach)
					? flattenEntity(entity)
					: {};
				const seed = identityValues(collection.key, currentTarget);

				// A block returns either one field-set (single merge) or an ARRAY
				// of field-sets — fan-out, one target entity per element (e.g. one
				// cert -> one host per SAN). Each element carries its own key.
				const batches = Array.isArray(output) ? output : [output];
				let changed = false;

				const isDerivation = block.mergeInto !== block.forEach;

				batches.forEach((fields) => {
					const result = envelope.makeResult(work, fields);
					const toMerge = Object.assign({}, seed, result.fields);
					const merged = db.upsert(block.mergeInto, toMerge, result.provenance);

					// Derivation (new-type entity) records a lineage edge from the
					// triggering parent to the produced child. Enrichment (same
					// type) records none.
					if (isDerivation) {
						db.addEdge({
							from: { type: block.forEach, key: entity._identity },
							rel: block.relation || block.id,
							to: { type: block.mergeInto, key: merged._identity },
							via: block.id,
							at: result.provenance.at
						});
					}

					// A version advance for this identity means it changed.
					const seenKey = block.mergeInto + "|" + merged._identity;

					if (merged._version > (seen[seenKey] || 0)) {
						changed = true;
					}

					seen[seenKey] = merged._version;
				});

				journal.record(Object.assign({
					status: "ok",
					changed: changed,
					input: work.input,
					output: output,
					outputs: batches.length,
					duration_ms: Date.now() - startedAt
				}, logBase));

				return changed;
			}).catch((error) => {
				// Handlers are meant to be tolerant, but if one throws we log the
				// failure (observable in the Executions panel) and rethrow so the
				// engine's own error handling is unchanged.
				journal.record(Object.assign({
					status: "error",
					changed: false,
					input: work.input,
					error: error && error.message ? error.message : String(error),
					duration_ms: Date.now() - startedAt
				}, logBase));

				throw error;
			});
		},

		// Re-run ONE block against ONE existing entity (the Executions "re-run").
		// Reuses _apply, so it journals the attempt and merges any output exactly
		// like a normal sweep. Resolves { ran, changed } — ran=false if the block
		// or entity is unknown. The flow's entity types are (re)defined so the
		// store is ready even on a cold process.
		runBlockById: (flow, blockId, entityType, entityKey) => {
			const prepared = Object.assign({}, flow, {
				_runId: flow._runId || uuid(),
				_sweep: flow._sweep || 0
			});
			const db = storeFor(prepared);

			Object.keys(flow.entities || {}).forEach((type) => { db.define(type, flow.entities[type]); });

			const block = (prepared.blocks || []).find((candidate) => { return candidate.id === blockId; });
			const entity = db.get(entityType, entityKey);

			if (!block || !entity) {
				return Promise.resolve({ ran: false, changed: false });
			}

			return engine._apply(prepared, block, entity, {}).then((changed) => {
				return { ran: true, changed: changed };
			});
		},

		// Run the whole flow to a fixpoint over its (bounded) source.
		run: (flow) => {
			const preparedFlow = Object.assign({}, flow, { _runId: uuid(), _sweep: 0 });
			const db = storeFor(preparedFlow);

			Object.keys(flow.entities).forEach((type) => {
				db.define(type, flow.entities[type]);
			});

			// Seed entities from the source (filter drops non-matching items).
			const seed = () => {
				return flow.source.pull().then((items) => {
					const at = new Date().toISOString();

					items.forEach((item) => {
						const ctx = {};
						ctx[flow.source.emits] = item;

						if (!passesWhen(flow.source.filter, ctx)) {
							return;
						}

						db.upsert(flow.source.emits, item, {
							block: flow.source.id || "source",
							source_item: null,
							at: at,
							raw_ref: null
						});
					});
				});
			};

			// One sweep: try every block against every current entity it has not
			// yet processed at the entity's current version. Returns whether the
			// store changed during the sweep.
			const sweep = (processed, seen) => {
				let changed = false;

				preparedFlow._sweep = preparedFlow._sweep + 1;

				// Sequential chain so fixpoint accounting is deterministic;
				// per-block concurrency/rate still comes from queue-promised.
				return preparedFlow.blocks.reduce((chain, block) => {
					return chain.then(() => {
						const entities = db.all(block.forEach);

						return entities.reduce((inner, entity) => {
							return inner.then(() => {
								const key = block.id + "|" + entity._identity;

								if (processed[key] === entity._version) {
									return null;
								}

								processed[key] = entity._version;

								return engine._apply(preparedFlow, block, entity, seen)
									.then((didChange) => {
										if (didChange) {
											changed = true;
										}
									});
							});
						}, Promise.resolve());
					});
				}, Promise.resolve()).then(() => {
					return changed;
				});
			};

			// Iterate sweeps to a fixpoint.
			const converge = () => {
				const processed = {};
				const seen = {};

				const step = (sweepsLeft) => {
					if (sweepsLeft <= 0) {
						throw new Error("flow did not converge within " + MAX_SWEEPS + " sweeps");
					}

					return sweep(processed, seen).then((changed) => {
						if (!changed) {
							return null;
						}

						return step(sweepsLeft - 1);
					});
				};

				return step(MAX_SWEEPS);
			};

			return seed().then(converge);
		}
	};

	return engine;
};

module.exports = { create: createEngine };
