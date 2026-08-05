// Block: http.security-txt — fetch /.well-known/security.txt (RFC 9116), falling
// back to the legacy /security.txt location. It yields the operator's abuse /
// disclosure contacts — a strong recon-to-attribution signal and, in forensics,
// exactly the addresses you report an incident to. Contacts that are emails are
// returned as `security_emails` (type -> email to grow the graph); other
// contacts (URLs, phone) go in `security_contacts`. Tolerant.

const http = require("../../services/http");

const LOCATIONS = ["/.well-known/security.txt", "/security.txt"];

const contactValues = (body) => {
	return String(body || "").split(/\r?\n/)
		.map((line) => {
			const match = line.match(/^\s*Contact\s*:\s*(.+?)\s*$/i);
			return match ? match[1] : null;
		})
		.filter(Boolean);
};

const expires = (body) => {
	const match = String(body || "").match(/^\s*Expires\s*:\s*(.+?)\s*$/im);
	return match ? match[1] : undefined;
};

// Try each location in order; resolve the first body that looks like a real
// security.txt (has a Contact line). Returns "" if none qualify.
const fetchFirst = (base, locations) => {
	if (locations.length === 0) {
		return Promise.resolve("");
	}

	return http.get(base + locations[0], { timeout: 4000 }).then((response) => {
		if (response.status === 200 && /^\s*Contact\s*:/im.test(String(response.body || ""))) {
			return response.body;
		}

		return fetchFirst(base, locations.slice(1));
	}).catch(() => {
		return fetchFirst(base, locations.slice(1));
	});
};
const host = require("../../utils/host");

module.exports = {
	uses: "http.security-txt",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const base = host.url(input);

		if (!base) {
			return Promise.resolve({});
		}

		return fetchFirst(base, LOCATIONS).then((body) => {
			if (!body) {
				return {};
			}

			const contacts = contactValues(body);

			const emails = contacts
				.filter((value) => { return value.indexOf("mailto:") === 0 || value.indexOf("@") !== -1; })
				.map((value) => { return value.replace(/^mailto:/i, ""); });

			const others = contacts
				.filter((value) => { return value.indexOf("mailto:") !== 0 && value.indexOf("@") === -1; });

			const fields = {};

			if (emails.length > 0) { fields.security_emails = Array.from(new Set(emails)); }
			if (others.length > 0) { fields.security_contacts = Array.from(new Set(others)); }
			if (expires(body)) { fields.security_expires = expires(body); }

			return fields;
		});
	}
};
