// Block: http.robots — fetch /robots.txt off a base URL and parse it. Robots is
// a free map of paths the operator would rather you didn't look at (Disallow)
// plus pointers to sitemaps — both are recon leads. `robots_disallow` can be
// typed to link -> a path/webpage entity so each rule grows the graph; sitemaps
// are full URLs ready to feed a crawler. Tolerant: missing/!=200 => {}.

const http = require("../../services/http");

const directive = (line, name) => {
	const match = line.match(new RegExp("^\\s*" + name + "\\s*:\\s*(.+?)\\s*$", "i"));

	if (!match) {
		return null;
	}

	return match[1];
};
const host = require("../../utils/host");

module.exports = {
	uses: "http.robots",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const base = host.url(input);

		if (!base) {
			return Promise.resolve({});
		}

		return http.get(base + "/robots.txt", { timeout: 4000 }).then((response) => {
			if (response.status !== 200) {
				return {};
			}

			const lines = String(response.body || "").split(/\r?\n/);

			const disallow = lines
				.map((line) => { return directive(line, "Disallow"); })
				.filter((value) => { return value && value !== "/"; });

			const sitemaps = lines
				.map((line) => { return directive(line, "Sitemap"); })
				.filter(Boolean);

			const fields = {};

			if (disallow.length > 0) { fields.robots_disallow = Array.from(new Set(disallow)); }
			if (sitemaps.length > 0) { fields.sitemaps = Array.from(new Set(sitemaps)); }

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
