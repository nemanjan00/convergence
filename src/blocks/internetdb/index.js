// Block: internetdb — Shodan's free InternetDB (internetdb.shodan.io): open
// ports, detected CPEs, hostnames, tags and known CVEs for an IP, with NO API
// key and no active scanning (it's Shodan's cached view). A cornerstone of
// attack-surface mapping: one call turns an ip entity into ports + a CVE list.
// `hostnames` type -> host, `vulns` -> a cve/vuln entity. Via services/http.
// Tolerant: unknown IP (404) / failure => {}.

const http = require("../../services/http");
const host = require("../../utils/host");

module.exports = {
	uses: "internetdb",
	rate: { maxConcurrent: 5 },
	handler: (input) => {
		const ip = host.ip(input);

		if (!ip) {
			return Promise.resolve({});
		}

		return http.getJson("https://internetdb.shodan.io/" + encodeURIComponent(ip)).then((data) => {
			if (!data) {
				return {};
			}

			const fields = {};

			if (data.ports && data.ports.length > 0) { fields.open_ports = data.ports; }
			if (data.hostnames && data.hostnames.length > 0) { fields.hostnames = data.hostnames; }
			if (data.cpes && data.cpes.length > 0) { fields.cpes = data.cpes; }
			if (data.tags && data.tags.length > 0) { fields.tags = data.tags; }
			if (data.vulns && data.vulns.length > 0) { fields.vulns = data.vulns; }

			return fields;
		});
	}
};
