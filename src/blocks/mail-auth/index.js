// Block: mail.auth — email authentication posture for a name via DNS TXT: the
// SPF record and the DMARC policy (_dmarc.<name>). Standard, non-intrusive
// domain recon. Always returns spf/dmarc (null when absent) so the guard
// `spf $exists false` fires it exactly once. Tolerant.

const dns = require("dns").promises;

const findTxt = (records, prefix) => {
	for (let i = 0; i < records.length; i++) {
		const text = Array.isArray(records[i]) ? records[i].join("") : records[i];

		if (text.toLowerCase().indexOf(prefix) === 0) {
			return text;
		}
	}

	return null;
};

module.exports = {
	uses: "mail.auth",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = String(input.name || "").replace(/^\*\./, "").trim();

		if (!name) {
			return Promise.resolve({});
		}

		return Promise.allSettled([
			dns.resolveTxt(name),
			dns.resolveTxt("_dmarc." + name)
		]).then((results) => {
			const spf = results[0].status === "fulfilled" ? findTxt(results[0].value, "v=spf1") : null;
			const dmarc = results[1].status === "fulfilled" ? findTxt(results[1].value, "v=dmarc1") : null;

			return { spf: spf, dmarc: dmarc };
		});
	}
};
