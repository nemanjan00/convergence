// Block registry. Each block is a SELF-CONTAINED module ({ uses, rate, handler })
// that owns its external dependencies. Blocks are loaded TOLERANTLY: if a block
// can't be required (e.g. an optional external dep like node-rdap-lacnic isn't
// installed), it is skipped with a warning instead of breaking the whole
// registry — a missing dep disables only that one block.
//
// register() wires every loaded block into a runtime; a flow's `uses:` names
// then resolve to real handlers.

// Paths of built-in block modules. Add new blocks here (or, later, discover
// them from a plugins directory / installed packages).
const BLOCK_MODULES = [
	"./fanout",
	"./dns",
	"./dns-aaaa",
	"./dns-txt",
	"./dns-ns",
	"./dns-cname",
	"./dns-caa",
	"./port-scan",
	"./http-title",
	"./http-headers",
	"./http-robots",
	"./http-security-txt",
	"./http-favicon",
	"./rdap",
	"./asn",
	"./ip-geo",
	"./ip-reverse",
	"./tls-cert",
	"./http-paths",
	"./http-json",
	"./map",
	"./mail-mx",
	"./mail-auth",
	"./ip-country",
	"./js"
];

const load = (modulePath) => {
	try {
		return require(modulePath);
	} catch (error) {
		console.error("block failed to load (skipped): " + modulePath + " — " + error.message);

		return null;
	}
};

const BUILTIN = BLOCK_MODULES.map(load).filter(Boolean);

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

	// Register every loaded block into a runtime instance.
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
