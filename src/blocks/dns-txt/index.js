// Block: dns.txt — TXT records for a name, via the rotating resolver service (no
// single upstream sees the whole recon pattern). TXT is where operators leak
// SPF, domain-verification tokens (google-site-verification, MS, etc.) and other
// ownership tells, so we return every record joined AND pull the SPF line out
// on its own. Tolerant: no TXT / failure => {}.

const resolver = require("../../services/resolver");
const host = require("../../utils/host");

module.exports = {
	uses: "dns.txt",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = host.from(input);

		if (!name) {
			return Promise.resolve({});
		}

		return resolver.resolveTxt(name).then((records) => {
			// Each TXT answer is an array of string chunks — join them per record.
			const joined = records.map((chunks) => { return chunks.join(""); });

			if (joined.length === 0) {
				return {};
			}

			const fields = { txt: joined };
			const spf = joined.find((record) => { return record.toLowerCase().indexOf("v=spf1") === 0; });

			if (spf) { fields.spf = spf; }

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
