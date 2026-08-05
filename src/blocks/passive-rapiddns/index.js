// Block: passive.rapiddns — subdomains for a domain scraped from RapidDNS
// (rapiddns.io), a key-free passive-DNS source. A third independent provider
// alongside ct.subdomains and passive.hackertarget — running several and merging
// (per the subfinder model) beats any single one, since each has blind spots.
// Parses the hostnames out of the results HTML. `subdomains` type -> host. Via
// services/http. Tolerant: nothing / failure => {}.

const http = require("../../services/http");

const MAX_SUBDOMAINS = 1000;

module.exports = {
	uses: "passive.rapiddns",
	rate: { maxConcurrent: 2 },
	handler: (input) => {
		const domain = String(input.domain || input.name || "").replace(/^\*\./, "").trim();

		if (!domain) {
			return Promise.resolve({});
		}

		const url = "https://rapiddns.io/subdomain/" + encodeURIComponent(domain) + "?full=1";

		return http.get(url, { timeout: 10000 }).then((response) => {
			if (response.status !== 200) {
				return {};
			}

			const body = String(response.body || "");
			const suffix = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

			// Hostnames appear as table cell text; match any label chain ending in
			// the target domain.
			const pattern = new RegExp("[a-z0-9_-]+(?:\\.[a-z0-9_-]+)*\\." + suffix, "gi");
			const matches = body.match(pattern) || [];

			const subdomains = new Set();

			matches.forEach((name) => {
				const clean = name.toLowerCase().replace(/^\*\./, "");

				if (clean !== domain) {
					subdomains.add(clean);
				}
			});

			if (subdomains.size === 0) {
				return {};
			}

			return { subdomains: Array.from(subdomains).slice(0, MAX_SUBDOMAINS) };
		}).catch(() => {
			return {};
		});
	}
};
