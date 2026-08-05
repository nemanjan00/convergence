// Block: dns.spf — the SPF record(s) for a domain, as an array. SPF is just a
// TXT lookup, so this is like any other DNS block: it returns the results, it
// does NOT recurse. Expansion is composition — feed `spf` to `regex` (pull the
// `include:` domains / `ip4:`/`ip6:` netblocks out) or `filter`, type the
// extracted domains -> domain, and CONVERGENCE re-runs dns.spf on each, so the
// SPF tree self-feeds to a fixpoint (the same pattern as the self-feeding
// crawler). Via the rotating resolver. Tolerant: no SPF => {}.
//
//   expansion, by composition (no bespoke recursion):
//     dns.spf -> regex { includes: { pattern: "include:(\\S+)", group: 1, all: true } }
//             -> includes typed { links: domain } -> dns.spf on each (self-feeds)

const resolver = require("../../services/resolver");
const host = require("../../utils/host");

module.exports = {
	uses: "dns.spf",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = host.from(input);

		if (!name) {
			return Promise.resolve({});
		}

		return resolver.resolveTxt(name).then((records) => {
			const spf = records
				.map((chunks) => { return chunks.join(""); })
				.filter((record) => { return record.toLowerCase().indexOf("v=spf1") === 0; });

			if (spf.length === 0) {
				return {};
			}

			return { spf: spf };
		}).catch(() => {
			return {};
		});
	}
};
