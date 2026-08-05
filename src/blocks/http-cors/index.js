// Block: http.cors — probe a URL's CORS policy by sending a rogue Origin and
// seeing what Access-Control-Allow-* comes back. Reflecting an arbitrary origin
// (with credentials) or allowing `null` is a real misconfiguration — cross-site
// data theft. A focused, low-noise security check. Via services/http. Tolerant.

const http = require("../../services/http");

const PROBE_ORIGIN = "https://convergence-cors-probe.example";

module.exports = {
	uses: "http.cors",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url, { headers: { origin: PROBE_ORIGIN } }).then((response) => {
			const headers = response.headers || {};
			const acao = headers["access-control-allow-origin"];
			const acac = String(headers["access-control-allow-credentials"] || "").toLowerCase() === "true";

			if (!acao) {
				return {};
			}

			const reflects = acao === PROBE_ORIGIN;
			const wildcard = acao === "*";
			const nullOrigin = acao.toLowerCase() === "null";
			const issue = (reflects && acac) || (reflects) || nullOrigin || (wildcard && acac);

			const fields = { acao: acao, acac: acac };

			if (issue) {
				fields.cors_issue = reflects ? "reflects-origin" : (nullOrigin ? "null-origin" : "permissive");
			}

			return fields;
		}).catch(() => {
			return {};
		});
	}
};
