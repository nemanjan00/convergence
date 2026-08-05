// Block: ip.reverse — reverse-DNS (PTR) for an IP. In forensics this pivots an
// IP back to hostnames; when the ip entity's `hostname` field is typed to link
// to `host`, each PTR name materializes a host entity (ip --ptr--> host), so
// the graph grows from the IP outward. Tolerant: no PTR => no fields.

const dns = require("dns").promises;

module.exports = {
	uses: "ip.reverse",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const address = input.address;

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
