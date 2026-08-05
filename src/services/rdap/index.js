// RDAP (whois) lookup for an IP or range. Rate limited, and cached by range so
// a prefix is only queried once. Returns the RDAP record with `range` attached.
//
// The underlying library (node-rdap-lacnic) is ESM-only, so it is pulled in via
// utils/load and never blocks requiring this module. TODO: install
// node-rdap-lacnic (and sibling registries) to actually resolve at runtime.

const wrapper = require("queue-promised").wrapper;
const load = require("../../utils/load");
const cache = require("../cache");

const CACHE_PREFIX = "ip:range:";
const RATE = { minTime: 1000, count: 10 };

const whois = load("node-rdap-lacnic", "ip");

const rdap = {
	// Rate-limited raw RDAP call, with the error surfaced (logged then rethrown
	// so the caller keeps the original failure).
	_request: wrapper((ip) => {
		return whois(ip).catch((error) => {
			console.error(ip, error);

			throw error;
		});
	}, RATE),

	request: (ip) => {
		return cache.get(CACHE_PREFIX + ip).then((cached) => {
			if (cached !== null) {
				return JSON.parse(cached);
			}

			return rdap._request(ip.split("/")[0]).then((data) => {
				const record = Object.assign({}, data, { range: ip });

				return cache.set(CACHE_PREFIX + ip, JSON.stringify(record)).then(() => {
					return record;
				});
			});
		});
	}
};

module.exports = rdap;
