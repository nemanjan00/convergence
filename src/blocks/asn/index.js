// Block: ip.asn — ASN + announced prefix for an IP, via the Team Cymru bulk
// whois service. Runs for_each ip (an entity materialized by a typed host.ip
// field), enriching the ip node in the graph. Tolerant.

const asn = require("../../services/asn");
const host = require("../../utils/host");

module.exports = {
	uses: "ip.asn",
	rate: { maxConcurrent: 5 },
	handler: (input) => {
		const address = host.ip(input);

		if (!address) {
			return Promise.resolve({});
		}

		return asn.resolve([address]).then((map) => {
			const record = map[address];

			if (!record) {
				return {};
			}

			return {
				asn: record.asn,
				asn_name: record.asnName,
				prefix: record.prefix
			};
		}).catch(() => {
			return {};
		});
	}
};
