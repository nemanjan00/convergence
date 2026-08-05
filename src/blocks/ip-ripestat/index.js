// Block: ip.ripestat — RIPEstat network-info for an IP: the covering prefix and
// the announcing ASN(s), straight from RIPE's public data API (no key). Cheap,
// authoritative routing context that complements ip.asn/rdap; `asn` types -> an
// asn entity you then expand with asn.prefixes/asn.info. Via services/http.
// Tolerant: failure => {}.

const http = require("../../services/http");

module.exports = {
	uses: "ip.ripestat",
	rate: { maxConcurrent: 5 },
	handler: (input) => {
		const ip = input.ip || input.address;

		if (!ip) {
			return Promise.resolve({});
		}

		const url = "https://stat.ripe.net/data/network-info/data.json?resource=" + encodeURIComponent(ip);

		return http.getJson(url).then((body) => {
			const data = body && body.data;

			if (!data) {
				return {};
			}

			const fields = {};

			if (data.prefix) { fields.prefix = data.prefix; }

			if (data.asns && data.asns.length > 0) {
				fields.asn = data.asns[0];
				fields.asns = data.asns;
			}

			return fields;
		});
	}
};
