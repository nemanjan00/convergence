// Block: http.wayback — every URL the Wayback Machine has archived under a
// domain (its CDX index, key-free). Historical endpoint discovery on a huge
// scale: old admin pages, API routes, parameters and files that no longer link
// from the live site but still exist. `wayback_urls` type -> webpage. Deduped by
// urlkey server-side; capped here. Via services/http. Tolerant.

const http = require("../../services/http");
const host = require("../../utils/host");

const LIMIT = 1000;

module.exports = {
	uses: "http.wayback",
	rate: { maxConcurrent: 3 },
	handler: (input) => {
		const domain = host.from(input);

		if (!domain) {
			return Promise.resolve({});
		}

		const url = "https://web.archive.org/cdx/search/cdx?url=" +
			encodeURIComponent(domain + "/*") +
			"&output=json&fl=original&collapse=urlkey&limit=" + LIMIT;

		return http.get(url, { timeout: 15000 }).then((response) => {
			let rows;

			try {
				rows = JSON.parse(response.body);
			} catch {
				return {};
			}

			if (!Array.isArray(rows) || rows.length <= 1) {
				return {};
			}

			// Row 0 is the header ["original"]; the rest are [url].
			const urls = rows.slice(1).map((row) => { return row[0]; }).filter(Boolean);

			if (urls.length === 0) {
				return {};
			}

			return { wayback_urls: Array.from(new Set(urls)), wayback_count: urls.length };
		}).catch(() => {
			return {};
		});
	}
};
