// Block: http.dirdig — "dirdigger", a recursive content prober. Where http.paths
// is a one-shot signal-finder over a tiny list, dirdig probes a broader wordlist
// AND recurses ONE level into directories it discovers (a 301/403 on /admin →
// probe /admin/<word>), which is how real content-discovery finds nested panels.
// Still polite: bounded wordlist, capped total requests, rate-limited via
// services/http (browser-shaped egress). Tolerant: nothing found => {}.
//
// TODO: pluggable external wordlists + configurable depth via inputs.

const http = require("../../services/http");

const WORDS = [
	"admin", "administrator", "login", "dashboard", "panel", "console",
	"api", "api/v1", "api/v2", "graphql", "health", "status", "metrics",
	"actuator", "debug", "test", "dev", "staging", "backup", "backups",
	"old", "tmp", "uploads", "files", "download", "downloads", "assets",
	"static", "config", "conf", "settings", "server-status", "phpinfo.php",
	".git/HEAD", ".env", ".well-known/security.txt", "robots.txt",
	"sitemap.xml", "swagger", "swagger.json", "openapi.json", "wp-admin"
];

const DEPTH = 1;
const MAX_REQUESTS = 120;

// A hit is any answer that isn't a hard 404 / transport failure. 401/403 are
// "present but protected" — the most interesting kind.
const isHit = (status) => { return status && status !== 404; };

// Looks like a directory worth recursing into (redirect to a subpath, or a
// protected/again-listable dir), as opposed to a leaf file.
const isDir = (word, status) => {
	return word.indexOf(".") === -1 && (status === 301 || status === 302 || status === 403 || status === 200);
};
const host = require("../../utils/host");

module.exports = {
	uses: "http.dirdig",
	rate: { maxConcurrent: 3 },
	handler: (input) => {
		const root = host.url(input);

		if (!root) {
			return Promise.resolve({});
		}

		const budget = { left: MAX_REQUESTS };
		const hits = [];

		// Probe every word under `base`; return the sub-hits that look like dirs.
		const sweep = (base) => {
			const words = WORDS.filter(() => { return budget.left > 0; });

			return Promise.all(words.map((word) => {
				if (budget.left <= 0) { return Promise.resolve(null); }
				budget.left = budget.left - 1;

				return http.get(base + "/" + word, { timeout: 4000 }).then((response) => {
					if (!isHit(response.status)) { return null; }

					const path = (base + "/" + word).slice(root.length) || "/";
					hits.push({ path: path, status: response.status });

					return isDir(word, response.status) ? base + "/" + word : null;
				}).catch(() => { return null; });
			})).then((results) => {
				return results.filter(Boolean);
			});
		};

		// Level 0, then recurse one level into discovered directories.
		const recurse = (bases, depth) => {
			return Promise.all(bases.map((base) => { return sweep(base); })).then((found) => {
				const dirs = found.flat();

				if (depth >= DEPTH || dirs.length === 0 || budget.left <= 0) {
					return null;
				}

				return recurse(dirs, depth + 1);
			});
		};

		return recurse([root], 0).then(() => {
			if (hits.length === 0) {
				return {};
			}

			return { dug_paths: hits, requests_made: MAX_REQUESTS - budget.left };
		});
	}
};
