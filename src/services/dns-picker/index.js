// IPv6-aware address picker. Resolves a host via random public resolvers
// (rate limited, process-cached) and prefers AAAA over A — used when a block
// wants a single connectable address and would rather egress over IPv6.

const dns = require("dns");
const wrapper = require("queue-promised").wrapper;
const validServers = require("../../../data/valid-dns-v6-servers.json");

const SERVERS_PER_QUERY = 4;
const MAX_CONCURRENT = 100;

const dnsPicker = {
	_cache: {},

	_resolve: wrapper((host, servers, record) => {
		const resolver = new dns.promises.Resolver({ timeout: 700, tries: 1 });
		resolver.setServers(servers);

		return resolver.resolve(host, record);
	}, MAX_CONCURRENT),

	resolveUsingRandomServer: (host, record) => {
		if (dnsPicker._cache[host] && dnsPicker._cache[host][record]) {
			return Promise.resolve(dnsPicker._cache[host][record]);
		}

		const servers = Array(SERVERS_PER_QUERY)
			.fill()
			.map(() => {
				return Math.floor(Math.random() * validServers.length);
			})
			.map((i) => {
				return validServers[i].ip_address;
			});

		return dnsPicker._resolve(host, servers, record).then((results) => {
			dnsPicker._cache[host] = dnsPicker._cache[host] || {};
			dnsPicker._cache[host][record] = results;

			return results;
		});
	},

	// Prefer IPv6 (AAAA); fall back to IPv4 (A).
	pickIP: (host) => {
		return Promise.allSettled([
			dnsPicker.resolveUsingRandomServer(host, "AAAA"),
			dnsPicker.resolveUsingRandomServer(host, "A")
		]).then((results) => {
			if (results[0].status === "fulfilled" && results[0].value.length > 0) {
				return { version: 6, address: results[0].value };
			}

			if (results[1].status === "fulfilled" && results[1].value.length > 0) {
				return { version: 4, address: results[1].value };
			}

			throw results[0].reason;
		});
	}
};

module.exports = dnsPicker;
