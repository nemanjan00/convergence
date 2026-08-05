// Source: source.ct-log — emit `cert` entities from Certificate Transparency
// logs. Queries providers in order (crt.sh, then CertSpotter) and uses the first
// that returns results, so a crt.sh outage (frequent 502s) doesn't stop the
// flow. A source exposes pull(params) => Promise<item[]>.
//
// params.match_domains: domains to query (each queried for its subdomains).
//
// NEEDS NETWORK. Each provider's row->cert mapping is tested offline.

const crtsh = require("../../services/crtsh");
const certspotter = require("../../services/certspotter");

// Provider fallback order.
const PROVIDERS = [crtsh, certspotter];

// Bound how many distinct hostnames a single pull enriches, so a domain with
// hundreds of CT names stays demo-fast. Not silent: the drop is logged.
const MAX_HOSTS = 12;

// Try each provider until one returns certs; tolerate all failing (=> []).
const searchWithFallback = (domain) => {
	const tryProvider = (index) => {
		if (index >= PROVIDERS.length) {
			return Promise.resolve([]);
		}

		return PROVIDERS[index].search(domain).then((certs) => {
			if (certs.length > 0) {
				return certs;
			}

			return tryProvider(index + 1);
		}).catch((error) => {
			console.error("ct-log: " + PROVIDERS[index].name + " failed for " +
				domain + " — " + error.message);
			return tryProvider(index + 1);
		});
	};

	return tryProvider(0);
};

module.exports = {
	source: "source.ct-log",
	pull: (params) => {
		const domains = (params && params.match_domains) || [];

		if (domains.length === 0) {
			return Promise.resolve([]);
		}

		return Promise.all(domains.map((domain) => {
			// A "*.example.com" pattern queries the base domain.
			return searchWithFallback(domain.replace(/^\*\./, ""));
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
