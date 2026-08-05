// Execution journal — an append-only log of every block execution, so a run is
// observable after the fact the way n8n's Executions panel is: which block ran
// against which entity, with what input, what it produced, whether it changed
// anything, how long it took, and any error.
//
// The engine writes one entry per block/entity attempt (including guard-skips
// and errors). The frontend renders it; a single execution can be re-run by
// replaying its (block, entity) pair.
//
// Like the entity store this is the in-memory REFERENCE implementation, capped
// so a long run can't grow unbounded. Persistence mirrors the store's shape: an
// `executions` collection in Mongo (see services/persistence) — same
// durable-across-runs contract, so logs survive restarts.

const uuid = require("uuid").v4;

const MAX_ENTRIES = 5000;

const ENTRIES = [];

const journal = {
	// Record one execution. `entry` is a plain object (see the engine for the
	// full shape); id/at are filled if absent. Returns the stored entry.
	record: (entry) => {
		const stored = Object.assign({
			id: uuid(),
			at: new Date().toISOString()
		}, entry);

		ENTRIES.push(stored);

		// Ring-buffer: drop the oldest once over the cap.
		if (ENTRIES.length > MAX_ENTRIES) {
			ENTRIES.splice(0, ENTRIES.length - MAX_ENTRIES);
		}

		return stored;
	},

	// All entries, newest last (insertion order).
	all: () => {
		return ENTRIES.slice();
	},

	// Entries for one block id (the flow node), for the builder's per-node view.
	forBlock: (blockId) => {
		return ENTRIES.filter((entry) => { return entry.block === blockId; });
	},

	// Entries touching one entity (type + identity), for the explorer's per-row
	// "how did this entity get built" view.
	forEntity: (type, key) => {
		return ENTRIES.filter((entry) => {
			return entry.entity && entry.entity.type === type && entry.entity.key === key;
		});
	},

	// The LATEST execution per (block, entity) — collapses a target's retry
	// history to its current state. Insertion order is chronological, so the last
	// write for a key wins.
	latestByTarget: () => {
		const latest = {};

		ENTRIES.forEach((entry) => {
			const key = entry.block + "|" +
				(entry.entity ? entry.entity.type + "|" + entry.entity.key : "-");

			latest[key] = entry;
		});

		return Object.keys(latest).map((key) => { return latest[key]; });
	},

	// The retry queue: targets whose FINAL state is an error. An entity that
	// failed once but later succeeded is NOT here — only genuinely-stuck ones,
	// so "re-run failed" retries exactly what still needs it.
	failed: () => {
		return journal.latestByTarget().filter((entry) => { return entry.status === "error"; });
	},

	// Load previously persisted entries (hydrate before a run).
	hydrate: (entries) => {
		(entries || []).forEach((entry) => { ENTRIES.push(entry); });

		return journal;
	},

	_reset: () => {
		ENTRIES.length = 0;

		return journal;
	}
};

module.exports = journal;
