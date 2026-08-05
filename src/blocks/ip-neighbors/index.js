// Block: ip.neighbors — other domains hosted on the same IP (reverse-IP / shared
// hosting), via HackerTarget's key-free endpoint. On shared infra this is a big
// graph-grower: one IP surfaces a whole set of co-located sites, each typed ->
// host. (HackerTarget rate-limits unauthenticated use to ~50/day/IP, so a limit
// message is treated as "no data", tolerantly.) Via services/http.

const http = require("../../services/http");
const host = require("../../utils/host");

module.exports = {
	uses: "ip.neighbors",
	rate: { maxConcurrent: 3 },
	handler: (input) => {
		const ip = host.ip(input);

		if (!ip) {
			return Promise.resolve({});
		}

		const url = "https://api.hackertarget.com/reverseiplookup/?q=" + encodeURIComponent(ip);

		return http.get(url).then((response) => {
			const body = String(response.body || "").trim();

			// Errors/limits come back as a plain sentence, not a host list.
			if (response.status !== 200 || body === "" ||
				/error|api count exceeded|no records|invalid/i.test(body)) {
				return {};
			}

			const domains = body.split(/\r?\n/)
				.map((line) => { return line.trim(); })
				.filter((line) => { return line.length > 0 && line.indexOf(".") !== -1; });

			if (domains.length === 0) {
				return {};
			}

			return { neighbor_domains: Array.from(new Set(domains)) };
		}).catch(() => {
			return {};
		});
	}
};
