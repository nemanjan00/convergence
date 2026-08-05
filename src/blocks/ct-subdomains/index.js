// Block: ct.subdomains — every subdomain a domain has ever gotten a certificate
// for, from the Certificate Transparency logs (crt.sh). The single biggest
// graph-grower in recon: one domain fans out to its whole historical hostname
// set. Reuses the crtsh service (retry/backoff; 502s are common). `subdomains`
// types -> host so each becomes its own node for DNS/TLS/HTTP enrichment.
// Wildcards dropped, deduped, capped. Tolerant: nothing / failure => {}.

const crtsh = require("../../services/crtsh");

const MAX_SUBDOMAINS = 500;

module.exports = {
	uses: "ct.subdomains",
	rate: { maxConcurrent: 2 },
	handler: (input) => {
		const domain = String(input.domain || input.name || "").replace(/^\*\./, "").trim();

		if (!domain) {
			return Promise.resolve({});
		}

		return crtsh.search(domain).then((certs) => {
			const names = new Set();
			const issuers = new Set();

			certs.forEach((cert) => {
				(cert.san || []).forEach((name) => {
					const clean = String(name).toLowerCase().trim();

					if (clean.length > 0 && clean.indexOf("*") === -1 && clean.indexOf(domain) !== -1) {
						names.add(clean);
					}
				});

				if (cert.issuer) { issuers.add(cert.issuer); }
			});

			if (names.size === 0) {
				return {};
			}

			return {
				subdomains: Array.from(names).slice(0, MAX_SUBDOMAINS),
				subdomain_count: names.size,
				ct_issuers: Array.from(issuers).slice(0, 50)
			};
		}).catch(() => {
			return {};
		});
	}
};
