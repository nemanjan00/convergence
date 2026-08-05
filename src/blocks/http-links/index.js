// Block: http.links — fetch a page and extract the links it points at, split
// into same-host (crawl surface) and off-host (related infrastructure). The
// external hostnames are the graph-growth signal: type `external_hosts` to link
// -> host and a page discovers its CDN, API, analytics and sibling domains.
// A light one-hop extractor, not a crawler. Tolerant: failure => {}.

const http = require("../../services/http");

const MAX_LINKS = 200;

module.exports = {
	uses: "http.links",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const base = response.url || url;
			let origin;

			try {
				origin = new URL(base).hostname;
			} catch {
				return {};
			}

			const body = String(response.body || "");
			const matches = body.match(/(?:href|src)\s*=\s*["']([^"']+)["']/gi) || [];

			const hrefs = matches
				.map((attr) => { return attr.replace(/^[^"']*["']/, "").replace(/["']$/, ""); })
				.slice(0, MAX_LINKS);

			const internal = new Set();
			const externalHosts = new Set();

			hrefs.forEach((href) => {
				try {
					const resolved = new URL(href, base);

					if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
						return;
					}

					if (resolved.hostname === origin) {
						internal.add(resolved.pathname);
					} else {
						externalHosts.add(resolved.hostname);
					}
				} catch {
					// ignore malformed hrefs (mailto:, javascript:, fragments…)
				}
			});

			const fields = {};

			if (internal.size > 0) { fields.internal_paths = Array.from(internal).slice(0, MAX_LINKS); }
			if (externalHosts.size > 0) { fields.external_hosts = Array.from(externalHosts); }

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
