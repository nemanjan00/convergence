// Block: http.paths — a light directory/content prober (dir-buster). Probes a
// small list of common paths against a base URL and reports the ones that exist
// (anything that isn't a 404/hard-down). Deliberately a SMALL, polite wordlist
// and rate-limited via services/http (browser-shaped egress) — a signal-finder,
// not an aggressive brute-forcer. Tolerant.
//
// TODO: pluggable/large wordlists (params) for real content discovery.

const http = require("../../services/http");

const WORDLIST = [
	"/robots.txt", "/sitemap.xml", "/.well-known/security.txt",
	"/admin", "/login", "/dashboard", "/api", "/api/health", "/status",
	"/health", "/metrics", "/server-status", "/.git/HEAD", "/.env",
	"/wp-login.php", "/config.json", "/backup"
];

// A path "exists" if the server answered with something other than 404 (or a
// transport failure). 401/403 are interesting signals (protected but present).
const found = (status) => {
	return status && status !== 404;
};

module.exports = {
	uses: "http.paths",
	rate: { maxConcurrent: 4 },
	handler: (input) => {
		const base = String(input.url || "").replace(/\/$/, "");

		if (!base) {
			return Promise.resolve({});
		}

		return Promise.all(WORDLIST.map((path) => {
			return http.get(base + path, { timeout: 4000 }).then((response) => {
				return { path: path, status: response.status };
			}).catch(() => {
				return null;
			});
		})).then((results) => {
			const hits = results.filter((result) => {
				return result && found(result.status);
			});

			if (hits.length === 0) {
				return {};
			}

			return { paths: hits };
		});
	}
};
