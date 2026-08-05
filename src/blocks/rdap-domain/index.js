// Block: rdap.domain — registration data for a DOMAIN (the whois successor) via
// the rdap.org bootstrap, which redirects to the authoritative registry. Yields
// the registrar, key lifecycle dates, and status flags — attribution and
// freshness signals (a freshly registered domain reads very differently in
// forensics). Any registrant email is typed to link -> email. No key, no dep.
// Sibling of the IP `rdap` block. Tolerant: failure => {}.

const TIMEOUT_MS = 8000;

// RDAP marks each date with an eventAction ("registration", "expiration"…).
const eventDate = (record, action) => {
	const events = record.events || [];
	const hit = events.find((event) => { return event.eventAction === action; });

	return hit ? hit.eventDate : undefined;
};

// Registrar name lives on the entity whose role is "registrar".
const registrarName = (record) => {
	const entities = record.entities || [];
	const registrar = entities.find((entity) => {
		return (entity.roles || []).indexOf("registrar") !== -1;
	});

	if (!registrar || !registrar.vcardArray || !registrar.vcardArray[1]) {
		return undefined;
	}

	const fn = registrar.vcardArray[1].find((row) => { return row[0] === "fn"; });

	return fn ? fn[3] : undefined;
};

// Any email appearing in any entity's vcard (registrant/admin/registrar).
const emails = (record) => {
	const found = [];

	(record.entities || []).forEach((entity) => {
		const vcard = entity.vcardArray && entity.vcardArray[1];

		if (!vcard) { return; }

		vcard.forEach((row) => {
			if (row[0] === "email" && row[3]) { found.push(row[3]); }
		});
	});

	return Array.from(new Set(found));
};
const host = require("../../utils/host");

module.exports = {
	uses: "rdap.domain",
	rate: { maxConcurrent: 5, maxPerMin: 120 },
	handler: (input) => {
		const domain = host.from(input);

		if (!domain) {
			return Promise.resolve({});
		}

		return fetch("https://rdap.org/domain/" + encodeURIComponent(domain), {
			redirect: "follow",
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: "application/rdap+json" }
		}).then((response) => {
			if (!response.ok) {
				return {};
			}

			return response.json().then((record) => {
				const fields = {
					registrar: registrarName(record),
					registered_at: eventDate(record, "registration"),
					expires_at: eventDate(record, "expiration"),
					updated_at: eventDate(record, "last changed"),
					domain_status: (record.status && record.status.length > 0) ? record.status : undefined
				};

				const found = emails(record);

				if (found.length > 0) { fields.registrant_emails = found; }

				Object.keys(fields).forEach((key) => {
					if (fields[key] === undefined) { delete fields[key]; }
				});

				return fields;
			});
		}).catch(() => {
			return {};
		});
	}
};
