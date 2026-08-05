// Block: http.favicon — fetch /favicon.ico and compute its Shodan-style hash
// (mmh3 of the base64-encoded bytes). The hash is a strong pivot: identical
// favicons across unrelated hostnames/IPs betray shared infrastructure, a common
// framework/panel, or the same operator — you can hand `favicon_hash` straight
// to a `http.favicon.hash:<n>` Shodan/Censys query. Tolerant: no icon => {}.

const http = require("../../services/http");
const mmh3 = require("../../stdlib").mmh3;

// Python's base64.encodebytes: standard base64 wrapped to 76-char lines with a
// trailing newline. Shodan hashes exactly this representation, so we reproduce
// it before hashing.
const encodeBytes = (buffer) => {
	const b64 = buffer.toString("base64");
	const lines = b64.match(/.{1,76}/g) || [];

	return lines.join("\n") + "\n";
};

module.exports = {
	uses: "http.favicon",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const base = String(input.url || "").replace(/\/$/, "");

		if (!base) {
			return Promise.resolve({});
		}

		return http.get(base + "/favicon.ico", { responseType: "buffer", timeout: 4000 }).then((response) => {
			const body = response.body;

			if (response.status !== 200 || !body || body.length === 0) {
				return {};
			}

			return {
				favicon_hash: mmh3(encodeBytes(body)),
				favicon_bytes: body.length
			};
		}).catch(() => {
			return {};
		});
	}
};
