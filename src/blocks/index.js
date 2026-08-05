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
	"./regex",
	"./dns",
	"./dns-aaaa",
	"./dns-txt",
	"./dns-ns",
	"./dns-cname",
	"./dns-caa",
	"./dns-soa",
	"./dns-srv",
	"./dns-spf",
	"./ct-subdomains",
	"./passive-hackertarget",
	"./passive-rapiddns",
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
	"./http-wayback",
	"./http-crawl",
	"./http-sitemap",
	"./http-emails",
	"./http-forms",
	"./http-meta",
	"./http-waf",
	"./http-cors",
	"./rdap",
	"./rdap-domain",
	"./asn",
	"./asn-prefixes",
	"./asn-info",
	"./ip-geo",
	"./ip-reverse",
	"./ip-ripestat",
	"./ip-neighbors",
	"./internetdb",
	"./mail-dnsbl",
	"./tls-cert",
	"./tls-versions",
	"./tls-spki",
	"./cert-parse",
	"./ti-greynoise",
	"./ti-urlhaus",
	"./http-paths",
	"./http-json",
	"./map",
	"./mail-mx",
	"./mail-auth",
	"./ip-country",
	"./url-parse",
	"./email-parse",
	"./hash-digest",
	"./decode",
	"./refang",
	"./exif",
	"./webhook",
	"./cli",
	"./log",
	"./js"
];

const fs = require("fs");

// One-line description from a block's leading `// Block: <uses> — <text>.` comment
// (single source of truth — no separate metadata to drift).
const describeOf = (modulePath) => {
	try {
		const src = fs.readFileSync(require.resolve(modulePath), "utf8");
		const lines = [];

		src.split("\n").some((line) => {
			const match = line.match(/^\/\/ ?(.*)$/);
			if (match === null) { return true; }
			lines.push(match[1]);
			return false;
		});

		const text = lines.join(" ").replace(/\s+/g, " ").trim().replace(/^Block:\s*\S+\s*[—-]\s*/, "");

		return text.split(/\.\s/)[0].slice(0, 180);
	} catch {
		return "";
	}
};

const load = (modulePath) => {
	try {
		const mod = require(modulePath);

		if (mod && !mod.describe) { mod.describe = describeOf(modulePath); }

		return mod;
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

	// Register every loaded block into a runtime instance. Blocks declare
	// `rate: { maxConcurrent, maxPerMin }` (camelCase, matching the engine's
	// registerBlock options) — snake_case is tolerated for older declarations.
	register: (runtime) => {
		blocks.all().forEach((block) => {
			const rate = block.rate || {};

			runtime.registerBlock(block.uses, block.handler, {
				maxConcurrent: rate.maxConcurrent !== undefined ? rate.maxConcurrent : rate.max_concurrent,
				maxPerMin: rate.maxPerMin !== undefined ? rate.maxPerMin : rate.max_per_min
			});
		});

		return runtime;
	}
};

module.exports = blocks;
