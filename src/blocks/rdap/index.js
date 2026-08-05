// Block: rdap — registration data for an IP (network owner / handle) via the
// rdap.org bootstrap, which redirects to the authoritative RIR. No API key, no
// dependency. Tolerant: failures return no fields.
//
// (The richer, cached, rotating services/rdap — backed by node-rdap-lacnic +
// Redis — can back this block later; this is the zero-dep real version.)

const TIMEOUT_MS = 8000;

// Pull a readable org/registrant name out of an RDAP entity list.
const orgName = (record) => {
	const entities = record.entities || [];

	for (let i = 0; i < entities.length; i++) {
		const vcard = entities[i].vcardArray;

		if (vcard && vcard[1]) {
			const fn = vcard[1].find((row) => {
				return row[0] === "fn";
			});

			if (fn) {
				return fn[3];
			}
		}
	}

	return undefined;
};

module.exports = {
	uses: "rdap",
	rate: { maxConcurrent: 5, maxPerMin: 120 },
	handler: (input) => {
		const ip = input.ip;

		if (!ip) {
			return Promise.resolve({});
		}

		return fetch("https://rdap.org/ip/" + encodeURIComponent(ip), {
			redirect: "follow",
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: "application/rdap+json" }
		}).then((response) => {
			if (!response.ok) {
				return {};
			}

			return response.json().then((record) => {
				return {
					network: record.name || undefined,
					network_range: (record.startAddress && record.endAddress)
						? (record.startAddress + " – " + record.endAddress)
						: undefined,
					registrar: orgName(record)
				};
			});
		}).catch(() => {
			return {};
		});
	}
};
