// Block: ti.urlhaus — check a host/domain against abuse.ch URLhaus, a feed of
// URLs used for malware distribution. In forensics this flags an IOC as a known-
// bad host and returns the malicious URLs + threat tags seen on it. Uses the
// URLhaus host API (POST form). `malicious` is a boolean verdict; `urlhaus_urls`
// the evidence. Via fetch (POST). Tolerant: not listed / blocked => {}.

const TIMEOUT_MS = 8000;

module.exports = {
	uses: "ti.urlhaus",
	rate: { maxConcurrent: 4 },
	handler: (input) => {
		const host = input.host || input.domain || input.ip;

		if (!host) {
			return Promise.resolve({});
		}

		return fetch("https://urlhaus-api.abuse.ch/v1/host/", {
			method: "POST",
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "host=" + encodeURIComponent(host)
		}).then((response) => {
			if (!response.ok) {
				return {};
			}

			return response.json().then((data) => {
				if (!data || data.query_status !== "ok") {
					return {};
				}

				const urls = (data.urls || []).map((entry) => { return entry.url; }).filter(Boolean);
				const tags = Array.from(new Set((data.urls || []).flatMap((entry) => { return entry.tags || []; })));

				const fields = { malicious: urls.length > 0 };

				if (urls.length > 0) { fields.urlhaus_urls = urls.slice(0, 100); }
				if (tags.length > 0) { fields.urlhaus_tags = tags; }
				if (data.firstseen) { fields.urlhaus_first_seen = data.firstseen; }

				return fields;
			});
		}).catch(() => {
			return {};
		});
	}
};
