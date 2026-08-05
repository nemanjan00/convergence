// Block: dns.aaaa — resolve a hostname to its AAAA (IPv6) records. The sibling of
// dns.a for the v6 half of the attack surface (often forgotten, so often less
// hardened). Uses node's dns directly because services/resolver disables v6 by
// design. Type `ip6` to link -> ip so v6 addresses become their own nodes.
// Strips a leading wildcard label. Tolerant: no AAAA / failure => {}.

const dns = require("dns").promises;
const host = require("../../utils/host");

module.exports = {
	uses: "dns.aaaa",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = host.from(input);

		if (!name) {
			return Promise.resolve({});
		}

		return dns.resolve6(name).then((addresses) => {
			if (addresses.length === 0) {
				return {};
			}

			return { ip6: addresses[0], ip6s: addresses };
		}).catch(() => {
			return {};
		});
	}
};
