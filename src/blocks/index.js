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
	"./filter",
	"./dns",
	"./dns-aaaa",
	"./dns-txt",
	"./dns-ns",
	"./dns-cname",
	"./dns-caa",
	"./dns-soa",
	"./port-scan",
	"./port-banner",
	"./http-title",
	"./http-headers",
	"./http-robots",
	"./http-security-txt",
	"./http-favicon",
	"./http-redirects",
	"./http-links",
	"./http-cookies",
	"./http-dirdig",
	"./http-request",
	"./rdap",
	"./rdap-domain",
	"./asn",
	"./ip-geo",
	"./ip-reverse",
	"./tls-cert",
	"./tls-versions",
	"./http-paths",
	"./http-json",
	"./map",
	"./mail-mx",
	"./mail-auth",
	"./ip-country",
	"./url-parse",
	"./email-parse",
	"./hash-digest",
	"./webhook",
	"./cli",
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
