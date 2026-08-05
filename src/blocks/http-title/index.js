// Block: http.title — fetch a URL and extract the page title + a couple of
// fingerprinting headers, via services/http (browser-shaped egress: matching
// JA3 + rotated real UA). Tolerant: timeouts / failures return no fields.

const http = require("../../services/http");

module.exports = {
	uses: "http.title",
	rate: { maxConcurrent: 10 },
	example: { in: { url: "https://example.com" }, out: { http_status: 200, server: "nginx", title: "Example Domain" } },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const match = String(response.body || "").match(/<title[^>]*>([^<]*)<\/title>/i);

			return {
				http_status: response.status,
				server: response.headers.server || undefined,
				title: match ? match[1].trim() : undefined
			};
		}).catch(() => {
			return {};
		});
	}
};
