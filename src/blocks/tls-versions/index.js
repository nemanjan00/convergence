// Block: tls.versions — which TLS protocol versions a host:443 will negotiate.
// Complements tls.cert (what the cert says) with how the endpoint is configured:
// still speaking TLS 1.0/1.1 is a hardening finding; TLS 1.3 support is a
// freshness signal. Probes each version by forcing min===max and seeing whether
// the handshake completes — no sslscan, no external dep. Tolerant: unreachable
// host => {}.

const tls = require("tls");

const PORT = 443;
const TIMEOUT_MS = 5000;
const VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"];

const probe = (host, version) => {
	return new Promise((resolve) => {
		let settled = false;

		const finish = (ok) => {
			if (settled) { return; }
			settled = true;
			resolve(ok ? version : null);
		};

		const socket = tls.connect({
			host: host,
			port: PORT,
			servername: host,
			rejectUnauthorized: false,
			minVersion: version,
			maxVersion: version,
			timeout: TIMEOUT_MS
		}, () => {
			socket.destroy();
			finish(true);
		});

		socket.on("error", () => { finish(false); });
		socket.on("timeout", () => { socket.destroy(); finish(false); });
		socket.setTimeout(TIMEOUT_MS);
	});
};

module.exports = {
	uses: "tls.versions",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const host = input.host || input.target;

		if (!host) {
			return Promise.resolve({});
		}

		return Promise.all(VERSIONS.map((version) => { return probe(host, version); })).then((results) => {
			const supported = results.filter(Boolean);

			if (supported.length === 0) {
				return {};
			}

			// Anything below TLS 1.2 is worth flagging.
			const weak = supported.filter((version) => { return version === "TLSv1" || version === "TLSv1.1"; });

			const fields = { tls_versions: supported };

			if (weak.length > 0) { fields.tls_weak = weak; }

			return fields;
		});
	}
};
