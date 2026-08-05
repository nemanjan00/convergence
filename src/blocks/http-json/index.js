// Block: http.json — GET a URL (browser-shaped egress) and return the parsed
// JSON as a single `json` field. Pairs with the `map` block: fetch the raw
// record here, interpret it declaratively there — so you don't need a bespoke
// block per API. Tolerant.

const http = require("../../services/http");

module.exports = {
	uses: "http.json",
	rate: { maxConcurrent: 5 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			try {
				return { json: JSON.parse(response.body), http_status: response.status };
			} catch {
				return { http_status: response.status };
			}
		}).catch(() => {
			return {};
		});
	}
};
