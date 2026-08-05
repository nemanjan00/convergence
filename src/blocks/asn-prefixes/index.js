// Block: asn.prefixes — the CIDR prefixes an ASN announces, via RIPEstat (no
// key). Expands an org's footprint from a single ASN into its whole routed
// address space — the netblocks you then scan / reverse / geolocate. Each prefix
// types -> a subnet/ip entity. Accepts `asn` as a number or "AS15169". Via
// services/http. Tolerant: failure => {}.

const http = require("../../services/http");

const MAX_PREFIXES = 500;

module.exports = {
	uses: "asn.prefixes",
	rate: { maxConcurrent: 5 },
	handler: (input) => {
		const raw = input.asn !== undefined ? input.asn : input.as;

		if (raw === undefined || raw === null || raw === "") {
			return Promise.resolve({});
		}

		const asn = "AS" + String(raw).replace(/^AS/i, "");
		const url = "https://stat.ripe.net/data/announced-prefixes/data.json?resource=" + encodeURIComponent(asn);

		return http.getJson(url).then((body) => {
			const list = body && body.data && body.data.prefixes;

			if (!list || list.length === 0) {
				return {};
			}

			const prefixes = list.map((entry) => { return entry.prefix; }).filter(Boolean).slice(0, MAX_PREFIXES);
			const v4 = prefixes.filter((prefix) => { return prefix.indexOf(":") === -1; });
			const v6 = prefixes.filter((prefix) => { return prefix.indexOf(":") !== -1; });

			const fields = { prefixes: prefixes };

			if (v4.length > 0) { fields.prefixes_v4 = v4; }
			if (v6.length > 0) { fields.prefixes_v6 = v6; }

			return fields;
		});
	}
};
