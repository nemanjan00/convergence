// Block: http.cookies — inspect the Set-Cookie headers a URL returns and report
// the cookie names plus the security flags (Secure / HttpOnly / SameSite). A
// hardening/hygiene signal and a light framework fingerprint (PHPSESSID,
// JSESSIONID, csrftoken, __cf* …). Tolerant: no cookies / failure => {}.

const http = require("../../services/http");

// got lowercases and can join multiple Set-Cookie headers into an array.
const cookieHeaders = (headers) => {
	const raw = headers["set-cookie"];

	if (!raw) { return []; }

	return Array.isArray(raw) ? raw : [raw];
};

module.exports = {
	uses: "http.cookies",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const cookies = cookieHeaders(response.headers || {}).map((line) => {
				const name = line.split("=")[0].trim();
				const lower = line.toLowerCase();
				const sameSite = (lower.match(/samesite=([^;]+)/) || [])[1];

				return {
					name: name,
					secure: lower.indexOf("secure") !== -1,
					http_only: lower.indexOf("httponly") !== -1,
					same_site: sameSite ? sameSite.trim() : undefined
				};
			});

			if (cookies.length === 0) {
				return {};
			}

			return { cookies: cookies };
		}).catch(() => {
			return {};
		});
	}
};
