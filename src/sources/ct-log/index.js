// Source: source.ct-log — emit `cert` entities from Certificate Transparency
// logs (via crt.sh). A source exposes pull(params) => Promise<item[]>; the
// runtime feeds emitted items downstream (and applies the flow's `filter`).
//
// params.match_domains: domains to query (each queried for its subdomains).
//
// NEEDS NETWORK to actually return data (crt.sh). The mapping is tested offline
// via services/crtsh._map.

const crtsh = require("../../services/crtsh");

// Bound how many distinct hostnames a single pull enriches, so a domain with
// hundreds of CT names stays demo-fast. Not silent: the drop is logged.
const MAX_HOSTS = 12;

module.exports = {
	source: "source.ct-log",
	pull: (params) => {
		const domains = (params && params.match_domains) || [];

		if (domains.length === 0) {
			return Promise.resolve([]);
		}

		return Promise.all(domains.map((domain) => {
			// A "*.example.com" pattern queries the base domain. Tolerant: if
			// crt.sh stays down for a domain, yield no certs rather than failing
			// the whole flow.
			return crtsh.search(domain.replace(/^\*\./, "")).catch((error) => {
				console.error("ct-log: crt.sh failed for " + domain + " — " + error.message);
				return [];
			});
		})).then((perDomain) => {
			const certs = perDomain.reduce((all, batch) => {
				return all.concat(batch);
			}, []);

			// Drop wildcard SANs (unresolvable) and dedupe within each cert.
			const cleaned = certs.map((cert) => {
				const san = Array.from(new Set((cert.san || []).filter((name) => {
					return name.indexOf("*") === -1;
				})));

				return Object.assign({}, cert, { san: san });
			}).filter((cert) => {
				return cert.san.length > 0;
			});

			// Cap distinct hostnames (logged, not silent).
			const kept = {};
			let allowed = MAX_HOSTS;

			const capped = cleaned.map((cert) => {
				const san = cert.san.filter((name) => {
					if (kept[name]) { return true; }
					if (allowed <= 0) { return false; }
					kept[name] = true;
					allowed = allowed - 1;
					return true;
				});

				return Object.assign({}, cert, { san: san });
			}).filter((cert) => {
				return cert.san.length > 0;
			});

			const distinct = Object.keys(kept).length;
			console.error("ct-log: " + distinct + " distinct hostnames (cap " + MAX_HOSTS + ")");

			return capped;
		});
	}
};
