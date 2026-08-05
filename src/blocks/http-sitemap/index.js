// Block: http.sitemap — fetch /sitemap.xml and extract the URLs it lists,
// following one level of <sitemapindex> nesting. The operator's own map of their
// site: a clean, high-signal set of real pages (vs. guessing with a dir-buster).
// `sitemap_urls` type -> webpage. Via services/http. Tolerant: missing / !=200
// => {}.

const http = require("../../services/http");

const MAX_URLS = 2000;
const MAX_CHILD_SITEMAPS = 15;

const locs = (xml) => {
	const matches = String(xml || "").match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || [];

	return matches.map((tag) => { return tag.replace(/<\/?loc>/gi, "").trim(); });
};

module.exports = {
	uses: "http.sitemap",
	rate: { maxConcurrent: 4 },
	handler: (input) => {
		const base = String(input.url || "").replace(/\/$/, "");

		if (!base) {
			return Promise.resolve({});
		}

		const start = /sitemap.*\.xml$/i.test(base) ? base : base + "/sitemap.xml";

		return http.get(start, { timeout: 8000 }).then((response) => {
			if (response.status !== 200) {
				return {};
			}

			const body = String(response.body || "");
			const isIndex = /<sitemapindex/i.test(body);
			const entries = locs(body);

			if (!isIndex) {
				return entries.length > 0 ? { sitemap_urls: entries.slice(0, MAX_URLS) } : {};
			}

			// Sitemap index: fetch each child sitemap once and merge their <loc>s.
			const children = entries.slice(0, MAX_CHILD_SITEMAPS);

			return Promise.all(children.map((childUrl) => {
				return http.get(childUrl, { timeout: 8000 })
					.then((childResponse) => { return locs(childResponse.body); })
					.catch(() => { return []; });
			})).then((lists) => {
				const urls = Array.from(new Set(lists.flat()));

				return urls.length > 0 ? { sitemap_urls: urls.slice(0, MAX_URLS) } : {};
			});
		}).catch(() => {
			return {};
		});
	}
};
