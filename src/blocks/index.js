// Built-in block registry. Each block module exports { uses, rate, handler };
// this collects them and can register them all into a runtime in one call, so a
// flow's `uses:` names resolve to real handlers.
//
// Register your own blocks the same way, or call runtime.registerBlock directly.

const enrichCountry = require("./enrich-country");
const enrichJs = require("./enrich-js");

const BUILTIN = [
	enrichCountry,
	enrichJs
];

const blocks = {
	all: () => {
		return BUILTIN;
	},

	// Map form: uses -> block module.
	allMap: () => {
		const map = {};

		blocks.all().forEach((block) => {
			map[block.uses] = block;
		});

		return map;
	},

	// Register every built-in block into a runtime instance.
	register: (runtime) => {
		blocks.all().forEach((block) => {
			runtime.registerBlock(block.uses, block.handler, {
				maxConcurrent: block.rate && block.rate.max_concurrent,
				maxPerMin: block.rate && block.rate.max_per_min
			});
		});

		return runtime;
	}
};

module.exports = blocks;
