// Rotating DNS resolver. Every query goes out via a handful of randomly chosen
// public resolvers (so no single upstream sees the whole recon pattern), is
// rate limited, and filters bogus answers (0.0.0.0 / loopback). Exposes the
// standard dns.promises.Resolver method surface.

const dns = require("dns");
const wrapper = require("queue-promised").wrapper;
const validServers = require("../../../data/valid-dns-servers.json");

const SERVERS_PER_QUERY = 4;
const MAX_CONCURRENT = 100;

const RESOLVE_METHODS = [
	"resolve", "resolve4", "resolveAny", "resolveCaa",
	"resolveCname", "resolveMx", "resolveNaptr", "resolveNs",
	"resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa",
	"resolveTxt", "reverse"
];

const pickRandomServers = () => {
	return Array(SERVERS_PER_QUERY)
		.fill()
		.map(() => {
			return Math.floor(Math.random() * validServers.length);
		})
		.map((i) => {
			return validServers[i].ip_address;
		});
};

const isBogusIP = (ip) => {
	return ip === "0.0.0.0" || ip.startsWith("127.");
};

const rateLimitedCall = wrapper((method, args) => {
	const resolver = new dns.promises.Resolver({ timeout: 700, tries: 1 });
	resolver.setServers(pickRandomServers());

	return resolver[method](...args).then((results) => {
		const shouldFilter = method === "resolve4" ||
			(method === "resolve" && (args[1] === "A" || args[1] === "AAAA"));

		if (!shouldFilter) {
			return results;
		}

		const filtered = results.filter((entry) => {
			const ip = typeof entry === "string" ? entry : entry.address;
			return !isBogusIP(ip);
		});

		if (filtered.length === 0) {
			throw new Error("DNS returned only bogus IPs for " + args[0]);
		}

		return filtered;
	});
}, MAX_CONCURRENT);

class RandomResolver extends dns.promises.Resolver {
	constructor() {
		super({ timeout: 700, tries: 1 });
	}

	// IPv6 disabled on this resolver by design; use services/dns-picker for v6.
	resolve6() {
		return Promise.resolve([]);
	}
}

RESOLVE_METHODS.forEach((method) => {
	RandomResolver.prototype[method] = function (...args) {
		return rateLimitedCall(method, args);
	};
});

module.exports = new RandomResolver();
