// Block: dns.caa — CAA records for a name, via the rotating resolver. CAA says
// which CAs are allowed to issue for the domain (issue/issuewild) and where to
// report violations (iodef) — a config signal (which CA the operator trusts) and
// a mis-issuance check. Tolerant: no CAA / failure => {}.

const resolver = require("../../services/resolver");

module.exports = {
	uses: "dns.caa",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = String(input.name || "").replace(/^\*\./, "").trim();

		if (!name) {
			return Promise.resolve({});
		}

		return resolver.resolveCaa(name).then((records) => {
			if (records.length === 0) {
				return {};
			}

			const issue = records.map((record) => { return record.issue; }).filter(Boolean);
			const issuewild = records.map((record) => { return record.issuewild; }).filter(Boolean);
			const iodef = records.map((record) => { return record.iodef; }).filter(Boolean);

			const fields = {};

			if (issue.length > 0) { fields.caa_issue = Array.from(new Set(issue)); }
			if (issuewild.length > 0) { fields.caa_issuewild = Array.from(new Set(issuewild)); }
			if (iodef.length > 0) { fields.caa_iodef = Array.from(new Set(iodef)); }

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
