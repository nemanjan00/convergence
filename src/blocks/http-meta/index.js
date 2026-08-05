// Block: http.meta — pull the <meta> tags and <title> out of a page: the
// generator (a direct CMS/framework fingerprint — WordPress, Hugo, Next.js),
// the description, and Open Graph tags (og:site_name/title/type). Lightweight
// tech-and-identity fingerprinting with zero fingerprint DB. Via services/http.
// Tolerant: none / failure => {}.

const http = require("../../services/http");

const metaContent = (html, attrName, attrValue) => {
	const re = new RegExp(
		"<meta\\b[^>]*" + attrName + "\\s*=\\s*[\"']" + attrValue + "[\"'][^>]*>", "i");
	const tag = html.match(re);

	if (!tag) {
		return undefined;
	}

	const content = tag[0].match(/content\s*=\s*["']([^"']*)["']/i);

	return content ? content[1] : undefined;
};

module.exports = {
	uses: "http.meta",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const body = String(response.body || "");
			const fields = {};

			const title = body.match(/<title[^>]*>([^<]*)<\/title>/i);
			if (title) { fields.title = title[1].trim(); }

			const generator = metaContent(body, "name", "generator");
			if (generator) { fields.generator = generator; }

			const description = metaContent(body, "name", "description");
			if (description) { fields.description = description; }

			const og = {};
			["site_name", "title", "type", "url"].forEach((key) => {
				const value = metaContent(body, "property", "og:" + key);
				if (value) { og[key] = value; }
			});

			if (Object.keys(og).length > 0) { fields.og = og; }

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
