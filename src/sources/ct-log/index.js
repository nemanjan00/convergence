// Source: source.ct-log — emit `cert` entities from Certificate Transparency
// logs (via crt.sh). A source exposes pull(params) => Promise<item[]>; the
// runtime feeds emitted items downstream (and applies the flow's `filter`).
//
// params.match_domains: domains to query (each queried for its subdomains).
//
// NEEDS NETWORK to actually return data (crt.sh). The mapping is tested offline
// via services/crtsh._map.

const crtsh = require("../../services/crtsh");

module.exports = {
	source: "source.ct-log",
	pull: (params) => {
		const domains = (params && params.match_domains) || [];

		if (domains.length === 0) {
			return Promise.resolve([]);
		}

		return Promise.all(domains.map((domain) => {
			// A "*.example.com" pattern queries the base domain.
			return crtsh.search(domain.replace(/^\*\./, ""));
		})).then((perDomain) => {
			return perDomain.reduce((all, certs) => {
				return all.concat(certs);
			}, []);
		});
	}
};
