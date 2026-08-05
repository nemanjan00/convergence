// Batched IP intelligence: given a list of IPs, return
// { ip -> { asn, prefix, asnName, whois } }. Reads the cache in one mget, only
// resolves the misses (ASN in one bulk query, RDAP once per unique prefix), then
// writes results back with a one-week TTL. Recon facts are stable, so the cache
// carries most of the load.

const asn = require("../asn");
const rdap = require("../rdap");
const cache = require("../cache");

const CACHE_TTL = 7 * 24 * 60 * 60; // one week, seconds
const CACHE_PREFIX = "ip:lookup:";

const ipLookup = {
	asn: asn,
	whois: rdap,

	lookup: (ips) => {
		if (ips.length === 0) {
			return Promise.resolve({});
		}

		const cacheKeys = ips.map((ip) => {
			return CACHE_PREFIX + ip;
		});

		return cache.mget(cacheKeys).then((cached) => {
			const results = {};
			const uncachedIps = [];

			ips.forEach((ip, i) => {
				if (cached[i]) {
					results[ip] = JSON.parse(cached[i]);
				} else {
					uncachedIps.push(ip);
				}
			});

			if (uncachedIps.length === 0) {
				return results;
			}

			return ipLookup._resolveUncached(uncachedIps, results);
		});
	},

	// Resolve the cache misses and fold them into `results`.
	_resolveUncached: (uncachedIps, results) => {
		return asn.resolve(uncachedIps).then((asns) => {
			const prefixes = {};

			Object.values(asns).forEach((entry) => {
				prefixes[entry.prefix] = true;
			});

			return Promise.all(Object.keys(prefixes).map((range) => {
				return rdap.request(range);
			})).then((whoisData) => {
				const whoisMap = {};

				whoisData.forEach((record) => {
					if (record && record.range) {
						whoisMap[record.range] = record;
					}
				});

				Object.values(asns).forEach((entry) => {
					entry.whois = whoisMap[entry.prefix] || {};
				});

				return asns;
			}).catch((error) => {
				// A whois failure must not drop the ASN data we already have.
				console.error(error);

				Object.values(asns).forEach((entry) => {
					entry.whois = {};
				});

				return asns;
			}).then((resolvedAsns) => {
				const entries = Object.keys(resolvedAsns).map((ip) => {
					results[ip] = resolvedAsns[ip];

					return {
						key: CACHE_PREFIX + ip,
						value: JSON.stringify(resolvedAsns[ip])
					};
				});

				return cache.msetEx(entries, CACHE_TTL).then(() => {
					return results;
				});
			});
		});
	}
};

module.exports = ipLookup;
