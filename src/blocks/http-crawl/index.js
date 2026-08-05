// Block: http.crawl — a SELF-FEEDING crawler. The convergence-native way to
// crawl is NOT to loop inside the block: this fetches ONE page and emits the
// same-host links it finds as `crawl_links`, typed on the entity spec to
// materialize a `webpage` per URL. Each new webpage re-triggers http.crawl, so
// the ENGINE does the breadth-first walk and the crawl self-feeds to a fixpoint
// — the store is the portal, and URL identity dedupes so every page is fetched
// once (a re-emitted link is a no-op merge, so convergence terminates).
//
// Bound the walk in the FLOW, not here: guard with `when:` on a depth field, or
// cap the `webpage` set. Off-host links come back as `external_hosts` (→ host).
// A single hop, tolerant: unreachable => {}.
//
//   entity spec:
//     webpage: { key: ["url"], fields: { crawl_links: { links: webpage, as: url, rel: links_to } } }
//   block:
//     { uses: http.crawl, for_each: webpage, merge_into: webpage,
//       when: { depth: { $lt: 3 } }, inputs: { url: "{{ webpage.url }}" } }

const http = require("../../services/http");

const MAX_LINKS_PER_PAGE = 300;

const hrefsIn = (body) => {
	const matches = String(body || "").match(/href\s*=\s*["']([^"'#]+)["']/gi) || [];

	return matches.map((attr) => { return attr.replace(/^[^"']*["']/, "").replace(/["']$/, ""); });
};

module.exports = {
	uses: "http.crawl",
	rate: { maxConcurrent: 4 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		let origin;

		try {
			origin = new URL(url).hostname;
		} catch {
			return Promise.resolve({});
		}

		return http.get(url, { timeout: 6000 }).then((response) => {
			const sameHost = new Set();
			const externalHosts = new Set();

			hrefsIn(response.body).forEach((href) => {
				try {
					const resolved = new URL(href, url);

					if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
						return;
					}

					if (resolved.hostname === origin) {
						// Normalize (drop fragment/query) so identity dedupe is tight.
						sameHost.add(resolved.origin + resolved.pathname);
					} else {
						externalHosts.add(resolved.hostname);
					}
				} catch {
					// ignore malformed hrefs
				}
			});

			const title = String(response.body || "").match(/<title[^>]*>([^<]*)<\/title>/i);

			const fields = {
				http_status: response.status,
				crawl_links: Array.from(sameHost).slice(0, MAX_LINKS_PER_PAGE)
			};

			if (title) { fields.title = title[1].trim(); }
			if (externalHosts.size > 0) { fields.external_hosts = Array.from(externalHosts); }

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
