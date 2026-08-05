// Envelope helpers for the block contract (see docs/BLOCK_CONTRACT.md).
//
// A block never constructs these by hand and never parses raw wire bytes; it
// receives a validated work item and returns fields, and this module stamps
// provenance + wraps the result. Keeping it here (utils) because it is
// specification plumbing, not application logic.

const uuid = require("uuid").v4;

// Fields every work item must carry before a block will touch it.
const REQUIRED_WORK_KEYS = ["flow", "run", "block", "item_id", "input"];

const envelope = {
	// Build a work item to feed a block. `trace` is the provenance chain of
	// upstream block ids that produced this item.
	makeWorkItem: (options) => {
		return {
			flow: options.flow,
			run: options.run,
			block: options.block,
			item_id: options.item_id || uuid(),
			trace: options.trace || [],
			input: options.input || {}
		};
	},

	// Throws if a work item is missing required keys. Called by the runtime
	// before dispatch so a malformed item never reaches block code.
	assertWorkItem: (item) => {
		const missing = REQUIRED_WORK_KEYS.filter((key) => {
			return item === null || item === undefined || item[key] === undefined;
		});

		if (missing.length > 0) {
			throw new Error("invalid work item, missing: " + missing.join(", "));
		}

		return item;
	},

	// Wrap a block's produced fields into a result envelope, stamping one
	// provenance record that is later attached to EVERY field on merge.
	makeResult: (workItem, fields, options) => {
		const opts = options || {};

		return {
			item_id: workItem.item_id,
			block: workItem.block,
			ok: true,
			fields: fields || {},
			provenance: {
				block: workItem.block,
				source_item: workItem.item_id,
				at: opts.at || new Date().toISOString(),
				raw_ref: opts.raw_ref || null
			},
			emit: opts.emit || []
		};
	},

	// Wrap a failure so the runtime can decide retry/drop without losing the
	// error. Errors are surfaced, not swallowed.
	makeError: (workItem, error) => {
		return {
			item_id: workItem.item_id,
			block: workItem.block,
			ok: false,
			error: {
				message: error && error.message ? error.message : String(error),
				at: new Date().toISOString()
			}
		};
	}
};

module.exports = envelope;
