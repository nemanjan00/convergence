// Block: dns.cname — the CNAME target for a name, via the rotating resolver. The
// alias target is a classic pivot: it exposes CDN/SaaS backends (…cloudfront.net,
// …github.io, …herokudns.com) and, when dangling, subdomain-takeover risk. Type
// `cname` to link -> host so the target becomes its own node. Tolerant.

const resolver = require("../../services/resolver");
const host = require("../../utils/host");

module.exports = {
	uses: "dns.cname",
	rate: { maxConcurrent: 20 },
	handler: (input) => {
		const name = host.from(input);

		if (!name) {
			return Promise.resolve({});
		}

		return resolver.resolveCname(name).then((targets) => {
			if (targets.length === 0) {
				return {};
			}

			return { cname: targets[0], cnames: targets };
		}).catch(() => {
			return {};
		});
	}
};
