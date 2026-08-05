// Block: http.waf — detect the WAF/CDN in front of a site (wafw00f-lite) from
// response headers, cookies and server banner. Knowing you're talking to
// Cloudflare / Akamai / Sucuri / AWS CloudFront / Fastly / Imperva shapes every
// later decision (rate limits, real-origin hunting, egress). Signature-based on
// the passive response, no probing. Via services/http. Tolerant.

const http = require("../../services/http");

// vendor -> [header/cookie/server needles]
const SIGNATURES = {
	Cloudflare: ["cf-ray", "cf-cache-status", "__cfduid", "cf-mitigated"],
	Akamai: ["akamai", "x-akamai", "akamaighost"],
	Sucuri: ["x-sucuri-id", "x-sucuri-cache", "sucuri"],
	Imperva: ["incap_ses", "x-iinfo", "x-cdn"],
	"AWS CloudFront": ["x-amz-cf-id", "cloudfront"],
	Fastly: ["fastly-", "x-served-by", "x-fastly"],
	"F5 BIG-IP": ["bigipserver", "x-waf"],
	Varnish: ["x-varnish", "via: varnish"]
};

module.exports = {
	uses: "http.waf",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const headers = response.headers || {};
			const cookies = [].concat(headers["set-cookie"] || []).join(" ");
			const server = String(headers.server || "");

			// One lowercased haystack of header names+values, cookies, and server.
			const hay = (Object.keys(headers).map((key) => {
				return key + ":" + [].concat(headers[key]).join(",");
			}).join(" ") + " " + cookies + " " + server).toLowerCase();

			const detected = Object.keys(SIGNATURES).filter((vendor) => {
				return SIGNATURES[vendor].some((needle) => { return hay.indexOf(needle) !== -1; });
			});

			if (detected.length === 0) {
				return {};
			}

			return { waf: detected[0], waf_all: detected };
		}).catch(() => {
			return {};
		});
	}
};
