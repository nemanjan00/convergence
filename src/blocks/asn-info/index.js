// Block: asn.info — the holder/org name and basic announcement stats for an ASN,
// via RIPEstat as-overview (no key). Attribution context: turns "AS15169" into
// "Google LLC". Pairs with asn.prefixes to fully expand an org's network.
// Accepts `asn` as a number or "AS15169". Via services/http. Tolerant.

const http = require("../../services/http");

module.exports = {
	uses: "asn.info",
	rate: { maxConcurrent: 5 },
	handler: (input) => {
		const raw = input.asn !== undefined ? input.asn : input.as;

		if (raw === undefined || raw === null || raw === "") {
			return Promise.resolve({});
		}

		const asn = "AS" + String(raw).replace(/^AS/i, "");
		const url = "https://stat.ripe.net/data/as-overview/data.json?resource=" + encodeURIComponent(asn);

		return http.get(url).then((response) => {
			let body;

			try {
				body = JSON.parse(response.body);
			} catch {
				return {};
			}

			const data = body && body.data;

			if (!data) {
				return {};
			}

			const fields = {};

			if (data.holder) { fields.holder = data.holder; }
			if (data.announced !== undefined) { fields.announced = data.announced; }
			if (data.type) { fields.asn_type = data.type; }

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
