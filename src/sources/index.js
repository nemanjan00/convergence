// Source registry. Each source module exports { source, pull(params) }. Given a
// flow's source block name and params, bind a pull() the runtime can call.
// Mirrors src/blocks for symmetry.

const ctLog = require("./ct-log");

const BUILTIN = [
	ctLog
];

const sources = {
	all: () => {
		return BUILTIN;
	},

	allMap: () => {
		const map = {};

		sources.all().forEach((source) => {
			map[source.source] = source;
		});

		return map;
	},

	// Return a pull() bound to params for the named source block, or null if the
	// source is unknown (caller can then supply its own pull, e.g. in tests).
	pullFor: (sourceBlock, params) => {
		const source = sources.allMap()[sourceBlock];

		if (!source) {
			return null;
		}

		return () => {
			return source.pull(params);
		};
	}
};

module.exports = sources;
