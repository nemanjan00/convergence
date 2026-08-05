// Block: http.redirects — follow a URL's redirect chain and report where it
// lands. The hops reveal http->https upgrades, apex->www canonicalization, and
// (crucially for recon) redirects OFF the host to a SaaS/CDN/login portal — a
// pivot to new infrastructure. `final_host` is typed to link -> host so the
// landing host becomes its own node. Tolerant: failure => {}.

const http = require("../../services/http");

module.exports = {
	uses: "http.redirects",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const chain = response.redirects || [];
			const finalUrl = response.url || url;

			const fields = {
				http_status: response.status,
				final_url: finalUrl,
				redirected: chain.length > 0,
				redirect_count: chain.length
			};

			if (chain.length > 0) {
				fields.redirect_chain = chain;
			}

			try {
				fields.final_host = new URL(finalUrl).hostname;
			} catch {
				// leave final_host unset on an unparseable URL
			}

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
