// crt.sh client — query the Certificate Transparency logs over crt.sh's JSON
// API. This backs the source.ct-log source: given a domain, return the certs
// seen for it as `cert` entities.
//
// The live fetch needs network (crt.sh); the row->cert mapping (`_map`) is a
// pure function so it can be unit-tested offline against a fixture.
//
// TODO: crt.sh returns the full history per query; real streaming/polling (only
// NEW certs since a cursor) belongs in the streaming substrate milestone.

const got = require("got-verbose");

const CRTSH_URL = "https://crt.sh/";
const RETRIES = 4;
const RETRY_DELAY_MS = 2000;

const crtsh = {
	_client: got,

	// Map crt.sh JSON rows to `cert` entities.
	_map: (rows) => {
		return rows.map((row) => {
			return {
				id: row.id,
				common_name: row.common_name,
				san: String(row.name_value || "").split("\n").filter((name) => {
					return name.length > 0;
				}),
				issuer: row.issuer_name,
				not_before: row.not_before,
				not_after: row.not_after,
				serial: row.serial_number,
				// crt.sh's JSON view does not flag pre-certs; treat as leaf.
				is_precert: false
			};
		});
	},

	// Fetch certs for a domain (and its subdomains). crt.sh is frequently
	// overloaded (502s), so retry a few times with a short backoff.
	search: (domain) => {
		const url = CRTSH_URL + "?q=" + encodeURIComponent("%." + domain) + "&output=json";

		const attempt = (remaining) => {
			return crtsh._client.get(url).then((response) => {
				return crtsh._map(JSON.parse(response.body));
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

module.exports = crtsh;
