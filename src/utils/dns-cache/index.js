// Process-local caching DNS lookup, drop-in compatible with the `lookup`
// option of net.connect (callback form) and offering a promise form. Blocks
// that open raw sockets (e.g. the Team Cymru ASN whois) pass `lookup` here so
// repeated connections don't re-resolve the same host.
//
// TODO: swap the Map for `cacheable-lookup` (records-aware, TTL-honoring) once
// its ESM-only build is wired through utils/load. This shim is deliberately
// minimal.

const dns = require("dns");

const cacheable = {
	_cache: {},

	lookupAsync: (hostname, options) => {
		const family = (options && options.family) || 0;
		const key = hostname + "|" + family;

		if (cacheable._cache[key]) {
			return Promise.resolve(cacheable._cache[key]);
		}

		return dns.promises.lookup(hostname, options || {}).then((result) => {
			cacheable._cache[key] = result;

			return result;
		});
	},

	// net.connect-compatible: lookup(hostname, [options], callback).
	lookup: (hostname, optionsOrCallback, maybeCallback) => {
		let options = optionsOrCallback;
		let callback = maybeCallback;

		if (typeof optionsOrCallback === "function") {
			options = {};
			callback = optionsOrCallback;
		}

		return cacheable.lookupAsync(hostname, options).then((result) => {
			callback(null, result.address, result.family);
		}).catch((error) => {
			callback(error, null, null);
		});
	}
};

module.exports = cacheable;
