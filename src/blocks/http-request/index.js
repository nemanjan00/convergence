// Block: http.request — a generic HTTP caller. Where http.title/http.headers/
// http.favicon are opinionated single-purpose fetchers, this one calls an
// arbitrary endpoint with caller-specified method / query params / headers /
// body and returns the raw result — the building block for talking to any
// keyless recon API (RIPEstat, bgpview, hackertarget, web.archive CDX, …) from a
// flow without a bespoke block each time. Pairs with `map` to lift the JSON into
// typed fields. Browser-shaped egress via services/http. Tolerant.
//
//   inputs:
//     url:     "https://api.bgpview.io/asn/{{ asn }}/prefixes"
//     params:  { output: "json" }     # appended to the query string
//     headers: { accept: "application/json" }
//     as:      "prefixes"             # field name for the body (default "body")

const http = require("../../services/http");

const withParams = (url, params) => {
	if (!params || typeof params !== "object") {
		return url;
	}

	try {
		const parsed = new URL(url);

		Object.keys(params).forEach((key) => {
			parsed.searchParams.set(key, String(params[key]));
		});

		return parsed.toString();
	} catch {
		return url;
	}
};

module.exports = {
	uses: "http.request",
	rate: { maxConcurrent: 6 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(withParams(url, input.params), {
			headers: input.headers,
			timeout: input.timeout
		}).then((response) => {
			const key = input.as || "body";
			const fields = { http_status: response.status };

			// Parse JSON when it looks like JSON, else hand back the raw text.
			const body = String(response.body || "");
			const type = String((response.headers || {})["content-type"] || "");

			if (type.indexOf("json") !== -1 || /^[[{]/.test(body.trim())) {
				try {
					fields[key] = JSON.parse(body);
				} catch {
					fields[key] = body;
				}
			} else {
				fields[key] = body;
			}

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
