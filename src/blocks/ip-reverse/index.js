// Block: ip.reverse — reverse-DNS (PTR) for an IP. In forensics this pivots an
// IP back to hostnames; when the ip entity's `hostname` field is typed to link
// to `host`, each PTR name materializes a host entity (ip --ptr--> host), so
// the graph grows from the IP outward. Tolerant: no PTR => no fields.

const dns = require("dns").promises;
const host = require("../../utils/host");

module.exports = {
	uses: "ip.reverse",
	rate: { maxConcurrent: 20 },
	example: { in: { address: "1.1.1.1" }, out: { hostname: "one.one.one.one", hostnames: ["one.one.one.one"] } },
	handler: (input) => {
		const address = host.ip(input);

		if (!address) {
			return Promise.resolve({});
		}

		return dns.reverse(address).then((names) => {
			if (names.length === 0) {
				return {};
			}

			return { hostname: names[0], hostnames: names };
		}).catch(() => {
			return {};
		});
	}
};
