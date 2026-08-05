// Block: dns.soa — the SOA (Start Of Authority) record for a name, via the
// rotating resolver. SOA names the primary master name server (type `primary_ns`
// -> host) and the zone admin mailbox in DNS form (first dot -> @), which we
// normalize to an email (type `admin_email` -> email). Both grow the graph.
// Tolerant: no SOA / failure => {}.

const resolver = require("../../services/resolver");

// SOA rname is an email with the @ written as the first unescaped dot:
// "hostmaster.example.com" -> "hostmaster@example.com".
const rnameToEmail = (rname) => {
	const value = String(rname || "");
	const dot = value.indexOf(".");

	if (dot <= 0) {
		return undefined;
	}

	return value.slice(0, dot) + "@" + value.slice(dot + 1);
};

module.exports = {
	uses: "dns.soa",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = String(input.name || "").replace(/^\*\./, "").trim();

		if (!name) {
			return Promise.resolve({});
		}

		return resolver.resolveSoa(name).then((soa) => {
			if (!soa || !soa.nsname) {
				return {};
			}

			const fields = {
				primary_ns: soa.nsname,
				soa_serial: soa.serial
			};

			const email = rnameToEmail(soa.hostmaster);

			if (email) { fields.admin_email = email; }

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
