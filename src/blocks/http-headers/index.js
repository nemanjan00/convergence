// Block: http.headers — GET a URL (browser-shaped egress via services/http) and
// surface the response headers that matter for recon: what's serving the site
// (server / x-powered-by / via) and which hardening headers are present (HSTS,
// CSP, X-Frame-Options, X-Content-Type-Options). The *presence* of a security
// header is itself a fingerprint, so we report booleans, not just values.
// Tolerant: timeouts / failures return no fields.

const http = require("../../services/http");

module.exports = {
	uses: "http.headers",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const headers = response.headers || {};

			const fields = {
				http_status: response.status,
				server: headers.server || undefined,
				powered_by: headers["x-powered-by"] || undefined,
				via: headers.via || undefined,
				hsts: Boolean(headers["strict-transport-security"]),
				csp: Boolean(headers["content-security-policy"]),
				x_frame_options: headers["x-frame-options"] || undefined,
				x_content_type_options: headers["x-content-type-options"] || undefined
			};

			// Drop undefineds so the merge only records headers that were present.
			Object.keys(fields).forEach((key) => {
				if (fields[key] === undefined) { delete fields[key]; }
			});

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
