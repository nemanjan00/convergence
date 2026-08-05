// Block: dns.ns — the authoritative name servers for a name, via the rotating
// resolver. NS records reveal the DNS provider (Cloudflare, Route 53, self-
// hosted…) and, self-hosted, another set of the operator's own hosts. Type
// `nameservers` to link -> host so each name server grows the graph. Tolerant.

const resolver = require("../../services/resolver");

module.exports = {
	uses: "dns.ns",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = String(input.name || "").replace(/^\*\./, "").trim();

		if (!name) {
			return Promise.resolve({});
		}

		return resolver.resolveNs(name).then((servers) => {
			if (servers.length === 0) {
				return {};
			}

			return { nameservers: Array.from(new Set(servers)) };
		}).catch(() => {
			return {};
		});
	}
};
