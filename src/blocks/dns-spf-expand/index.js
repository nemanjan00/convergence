// Block: dns.spf-expand — recursively expand a domain's SPF record. SPF is a map
// of who may send mail for a domain, so expanding include:/redirect= reveals the
// mail/cloud vendors in use (google, outlook, sendgrid, marketing SaaS) and
// ip4:/ip6: hand you their sending netblocks. `spf_includes` type -> domain (and
// each recurses), `spf_netblocks` -> ip/subnet — a strong graph-grower and the
// backbone of the user's cert->TXT->SPF->domains pivot. Bounded recursion +
// lookup budget so a hostile chain can't explode. Via the rotating resolver.
// Tolerant: no SPF => {}.

const resolver = require("../../services/resolver");
const host = require("../../utils/host");

const MAX_DEPTH = 4;
const MAX_LOOKUPS = 20;

// The v=spf1 record for a name, or null.
const spfOf = (name) => {
	return resolver.resolveTxt(name).then((records) => {
		const joined = records.map((chunks) => { return chunks.join(""); });

		return joined.find((record) => { return record.toLowerCase().indexOf("v=spf1") === 0; }) || null;
	}).catch(() => { return null; });
};

module.exports = {
	uses: "dns.spf-expand",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const domain = host.from(input);

		if (!domain) {
			return Promise.resolve({});
		}

		const includes = new Set();
		const netblocks = new Set();
		const budget = { left: MAX_LOOKUPS };

		// Walk one record's mechanisms, recursing into include:/redirect=.
		const walk = (name, depth) => {
			if (depth > MAX_DEPTH || budget.left <= 0) {
				return Promise.resolve();
			}

			budget.left = budget.left - 1;

			return spfOf(name).then((spf) => {
				if (!spf) {
					return null;
				}

				const nested = [];

				spf.split(/\s+/).forEach((token) => {
					const value = token.replace(/^[+\-~?]/, "");

					if (value.indexOf("ip4:") === 0 || value.indexOf("ip6:") === 0) {
						netblocks.add(value.slice(4));
					} else if (value.indexOf("include:") === 0) {
						const target = value.slice(8);
						includes.add(target);
						nested.push(walk(target, depth + 1));
					} else if (value.indexOf("redirect=") === 0) {
						const target = value.slice(9);
						includes.add(target);
						nested.push(walk(target, depth + 1));
					}
				});

				return Promise.all(nested);
			});
		};

		return walk(domain, 0).then(() => {
			const fields = {};

			if (includes.size > 0) { fields.spf_includes = Array.from(includes); }
			if (netblocks.size > 0) { fields.spf_netblocks = Array.from(netblocks); }

			return fields;
		});
	}
};
