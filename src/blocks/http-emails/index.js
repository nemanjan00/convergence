// Block: http.emails — harvest email addresses from a page (mailto: links and
// inline text), theHarvester-style. Emails are attribution + phishing-surface
// signals and feed the email->CT/SPF pivots. `emails` type -> email so each
// address becomes its own node (email.parse then splits out its domain). Via
// services/http. Tolerant: none / failure => {}.

const http = require("../../services/http");

// Deliberately conservative so asset filenames (image@2x.png) don't masquerade
// as addresses: require a dotted TLD-ish domain.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Extensions that show up as "name@2x.ext" etc. — drop those false positives.
const JUNK = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/i;

module.exports = {
	uses: "http.emails",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const body = String(response.body || "");
			const matches = body.match(EMAIL_RE) || [];

			const emails = new Set();

			matches.forEach((email) => {
				const clean = email.toLowerCase();

				if (!JUNK.test(clean)) {
					emails.add(clean);
				}
			});

			if (emails.size === 0) {
				return {};
			}

			return { emails: Array.from(emails) };
		}).catch(() => {
			return {};
		});
	}
};
