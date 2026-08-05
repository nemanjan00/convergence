// Block: passive.hackertarget — subdomains AND their A records for a domain in
// one key-free call (HackerTarget hostsearch). A fast passive-DNS grower that
// complements ct.subdomains (CT sees only names that got certs; passive DNS sees
// names that ever resolved). Emits `subdomains` (-> host) and `ips` (-> ip).
// Rate-limited unauthenticated (~50/day/IP), so a limit message reads as no
// data. Via services/http. Tolerant.

const http = require("../../services/http");
const host = require("../../utils/host");

module.exports = {
	uses: "passive.hackertarget",
	rate: { maxConcurrent: 3 },
	handler: (input) => {
		const domain = host.from(input);

		if (!domain) {
			return Promise.resolve({});
		}

		const url = "https://api.hackertarget.com/hostsearch/?q=" + encodeURIComponent(domain);

		return http.get(url).then((response) => {
			const body = String(response.body || "").trim();

			if (response.status !== 200 || body === "" ||
				/error|api count exceeded|no records|invalid/i.test(body)) {
				return {};
			}

			// Each line: "host,ip".
			const subdomains = new Set();
			const ips = new Set();

			body.split(/\r?\n/).forEach((line) => {
				const parts = line.split(",");

				if (parts[0]) { subdomains.add(parts[0].trim().toLowerCase()); }
				if (parts[1] && /^\d+\.\d+\.\d+\.\d+$/.test(parts[1].trim())) { ips.add(parts[1].trim()); }
			});

			if (subdomains.size === 0) {
				return {};
			}

			return {
				subdomains: Array.from(subdomains),
				ips: Array.from(ips)
			};
		}).catch(() => {
			return {};
		});
	}
};
