// Block: url.parse — split a URL into its parts. A pure normalizer with no
// network: given a webpage/url entity it exposes scheme/host/port/path, and the
// `host` field is typed to link -> a host entity, so a page URL grows a host
// node the DNS/TLS/port blocks then enrich. Tolerant: unparseable => {}.

module.exports = {
	uses: "url.parse",
	rate: {},
	handler: (input) => {
		const raw = input.url;

		if (!raw) {
			return Promise.resolve({});
		}

		try {
			const parsed = new URL(raw);

			return Promise.resolve({
				scheme: parsed.protocol.replace(/:$/, ""),
				host: parsed.hostname,
				port: parsed.port || undefined,
				path: parsed.pathname || "/",
				query: parsed.search ? parsed.search.replace(/^\?/, "") : undefined
			});
		} catch {
			return Promise.resolve({});
		}
	}
};
