// Block: tls.spki — connect to host:443 and hash the server's SubjectPublicKey
// Info (SPKI). The SPKI SHA-256 is the value used in HPKP/pinning and, more
// usefully here, as a cross-host PIVOT: two hosts sharing an SPKI hash share a
// key (same origin server behind different names, or reused infra). Also returns
// the cert's own SHA-256 fingerprint. Complements tls.cert/tls.versions. Node
// tls, no dep. Tolerant: unreachable / no TLS => {}.

const tls = require("tls");
const createHash = require("crypto").createHash;

const PORT = 443;
const TIMEOUT_MS = 6000;

module.exports = {
	uses: "tls.spki",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const host = input.host || input.target;

		if (!host) {
			return Promise.resolve({});
		}

		return new Promise((resolve) => {
			let settled = false;

			const finish = (fields) => {
				if (settled) { return; }
				settled = true;
				resolve(fields);
			};

			const socket = tls.connect({
				host: host,
				port: PORT,
				servername: host,
				rejectUnauthorized: false,
				timeout: TIMEOUT_MS
			}, () => {
				const cert = socket.getPeerCertificate();
				socket.destroy();

				if (!cert || !cert.pubkey) {
					return finish({});
				}

				finish({
					spki_sha256: createHash("sha256").update(cert.pubkey).digest("hex"),
					cert_fingerprint256: cert.fingerprint256
				});
			});

			socket.on("error", () => { finish({}); });
			socket.on("timeout", () => { socket.destroy(); finish({}); });
			socket.setTimeout(TIMEOUT_MS);
		});
	}
};
