// The runtime: the deterministic executor. The AI composes a flow; this runs
// it. Blocks are registered handlers; a flow wires them over a source. Every
// field a block produces is merged into an entity with provenance.
//
// This first implementation runs in-process with bounded concurrency as the
// backpressure knob. The streaming/queue substrate (Kafka/NATS/Redis) and the
// per-item state machine (XState candidate) are future work — see
// docs/ARCHITECTURE.md.
//
// TODO(streaming): replace the array-drained source with a real unbounded
//   stream + per-edge bounded queues so a CT firehose can run for weeks.

const wrapper = require("queue-promised").wrapper;
const uuid = require("uuid").v4;
const sift = require("sift").default;
const config = require("../config");
const store = require("../services/store");
const envelope = require("../utils/envelope");

// Flatten a stored entity ({name: {value, provenance}}) to plain {name: value}
// so block input-resolvers can read `host.ip` naturally.
const flattenEntity = (entity) => {
	if (!entity) {
		return {};
	}

	const flat = {};

	Object.keys(entity.fields).forEach((name) => {
		flat[name] = entity.fields[name].value;
	});

	return flat;
};

// Pick just the identity fields from a flattened entity, so every merge keeps
// the entity keyed consistently as more blocks contribute.
const identityValues = (keyFields, flat) => {
	const seed = {};

	keyFields.forEach((name) => {
		if (flat[name] !== undefined) {
			seed[name] = flat[name];
		}
	});

	return seed;
};

// Evaluate a block's `when` guard. The guard is a Mongo-style query object
// (authored in YAML, so the AI writes declarative queries, not code) matched
// against the item's context with sift — the same dialect used against Mongo.
const passesWhen = (when, ctx) => {
	if (!when) {
		return true;
	}

	return sift(when)(ctx);
};

const createRuntime = () => {
	const runtime = {
		_blocks: {},

		// Register a block: a name and a handler(input) => Promise<fields>.
		// Rate limiting lives HERE, never inside the handler — the flow declares
		// it and the runtime enforces it via queue-promised:
		//   maxConcurrent -> count   (workers in flight)
		//   maxPerMin     -> minTime (min ms before each call resolves)
		registerBlock: (name, handler, options) => {
			const opts = options || {};
			const queueOptions = {
				count: opts.maxConcurrent || config.getNumber("DEFAULT_MAX_CONCURRENT")
			};

			if (opts.maxPerMin) {
				queueOptions.minTime = Math.ceil(60000 / opts.maxPerMin);
			}

			runtime._blocks[name] = {
				name: name,
				call: wrapper(handler, queueOptions)
			};

			return runtime;
		},

		// Run one source item through the ordered block pipeline, merging each
		// block's output into its target entity. Returns the final entity map
		// (ctx) for that item.
		_processItem: (flow, sourceItem) => {
			const runId = flow._runId;
			const ctx = {};
			ctx[flow.source.emits] = sourceItem;

			// Chain blocks sequentially per item; concurrency across items is
			// handled by the caller. Sequential here keeps provenance ordering
			// honest and lets a later block read an earlier block's fields.
			return flow.blocks.reduce((chain, block) => {
				return chain.then(() => {
					if (!passesWhen(block.when, ctx)) {
						return null;
					}

					const registered = runtime._blocks[block.uses];

					if (!registered) {
						throw new Error("unknown block: " + block.uses);
					}

					const work = envelope.makeWorkItem({
						flow: flow.name,
						run: runId,
						block: block.id,
						item_id: uuid(),
						trace: block.trace || [],
						input: block.inputs(ctx)
					});

					envelope.assertWorkItem(work);

					return registered.call(work.input).then((fields) => {
						const result = envelope.makeResult(work, fields);
						const collection = flow.entities[block.mergeInto];
						const currentFlat = ctx[block.mergeInto] || {};
						const seed = identityValues(collection.key, currentFlat);
						const toMerge = Object.assign({}, seed, result.fields);

						const merged = store.upsert(block.mergeInto, toMerge, result.provenance);
						// Keep the flattened entity in context so later blocks'
						// sift guards and input-resolvers can read its fields.
						ctx[block.mergeInto] = flattenEntity(merged);

						return merged;
					});
				});
			}, Promise.resolve()).then(() => {
				return ctx;
			});
		},

		// Run a whole flow to completion over its (bounded) source.
		run: (flow) => {
			const preparedFlow = Object.assign({}, flow, { _runId: uuid() });

			// Register entity types with the store from the flow definition.
			Object.keys(flow.entities).forEach((type) => {
				store.define(type, flow.entities[type]);
			});

			// Bounded concurrency across source items IS the backpressure knob:
			// only so many items are in flight, so a fast source cannot outrun
			// slow downstream blocks.
			const capacity = config.getNumber("QUEUE_CAPACITY");
			const boundedProcess = wrapper((item) => {
				return runtime._processItem(preparedFlow, item);
			}, capacity);

			return flow.source.pull().then((items) => {
				return Promise.all(items.map((item) => {
					return boundedProcess(item);
				}));
			});
		}
	};

	return runtime;
};

module.exports = { create: createRuntime };
