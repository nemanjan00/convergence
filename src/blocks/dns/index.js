// Block: dns.a — resolve a hostname to its A records. Tolerant: on any DNS
// failure it returns no fields (the entity simply stays un-resolved), so one bad
// name never breaks convergence. Strips a leading wildcard label so a
// "*.example.com" SAN resolves the base name.

const dns = require("dns").promises;
const host = require("../../utils/host");

module.exports = {
	uses: "dns.a",
	rate: { maxConcurrent: 20 },
	example: { in: { name: "example.com" }, out: { ip: "93.184.216.34", ips: ["93.184.216.34"] } },
	handler: (input) => {
		const name = host.from(input);

		if (!name) {
			return Promise.resolve({});
		}

		return dns.resolve4(name).then((addresses) => {
			if (addresses.length === 0) {
				return {};
			}

			return { ip: addresses[0], ips: addresses };
		}).catch(() => {
			return {};
		});
	}
};
