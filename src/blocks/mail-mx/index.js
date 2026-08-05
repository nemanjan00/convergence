// Block: mail.mx — the mail exchangers for a name (DNS MX), priority-ordered.
// Adapted from the MX half of the user's mail-check. Always returns an `mx`
// field (empty array when none) so the guard `mx $exists false` fires it exactly
// once. Tolerant.

const dns = require("dns").promises;
const host = require("../../utils/host");

module.exports = {
	uses: "mail.mx",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = host.from(input);

		if (!name) {
			return Promise.resolve({});
		}

		return dns.resolveMx(name).then((records) => {
			return {
				mx: records.sort((a, b) => {
					return a.priority - b.priority;
				}).map((record) => {
					return record.exchange;
				})
			};
		}).catch(() => {
			return { mx: [] };
		});
	}
};
