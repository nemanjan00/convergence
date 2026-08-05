// CertSpotter (SSLMate) CT client — a reliable alternative to crt.sh (which
// 502s constantly). Free, no API key for the basic issuances endpoint, and it
// returns dns_names directly. Same cert shape as services/crtsh so it's a
// drop-in fallback for source.ct-log.

const got = require("got-verbose");

const API = "https://api.certspotter.com/v1/issuances";
const RETRIES = 3;
const RETRY_DELAY_MS = 1500;

const certspotter = {
	name: "certspotter",
	_client: got,

	_map: (rows) => {
		return rows.map((row) => {
			const names = row.dns_names || [];

			return {
				id: row.id,
				common_name: names[0],
				san: names,
				issuer: row.issuer ? row.issuer.name : undefined,
				not_before: row.not_before,
				not_after: row.not_after,
				is_precert: false
			};
		});
	},

	search: (domain) => {
		const url = API + "?domain=" + encodeURIComponent(domain) +
			"&include_subdomains=true&expand=dns_names&expand=issuer" +
			"&expand=not_before&expand=not_after";

		const attempt = (remaining) => {
			return certspotter._client.get(url).then((response) => {
				return certspotter._map(JSON.parse(response.body));
			}).catch((error) => {
				if (remaining <= 0) {
					throw error;
				}

				return new Promise((resolve) => {
					setTimeout(resolve, RETRY_DELAY_MS);
				}).then(() => {
					return attempt(remaining - 1);
				});
			});
		};

		return attempt(RETRIES);
	}
};

module.exports = certspotter;
