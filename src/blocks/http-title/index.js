// Block: http.title — fetch a URL and extract the page title + a couple of
// fingerprinting headers. Sends a realistic browser User-Agent (rotated via the
// ported useragent util) so servers that sniff obvious bots still answer.
// Tolerant: timeouts / failures return no fields.
//
// TODO: route through services/http (TLS-fingerprint + egress-IP rotation) once
// that lands; Node's global fetch (undici) can't easily shape the JA3 yet.

const STATIC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 6000;

const userAgent = () => {
	try {
		return require("../../utils/useragent").getRandomUseragent() || STATIC_UA;
	} catch {
		return STATIC_UA;
	}
};

module.exports = {
	uses: "http.title",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return fetch(url, {
			redirect: "follow",
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { "user-agent": userAgent() }
		}).then((response) => {
			return response.text().then((body) => {
				const match = body.match(/<title[^>]*>([^<]*)<\/title>/i);

				return {
					http_status: response.status,
					server: response.headers.get("server") || undefined,
					title: match ? match[1].trim() : undefined
				};
			});
		}).catch(() => {
			return {};
		});
	}
};
