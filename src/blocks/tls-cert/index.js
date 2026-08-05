// Block: tls.cert — connect to host:443, read the live server certificate, and
// extract issuer / subject / expiry / SANs. crt.sh-independent (it talks to the
// host directly). The SANs are a great graph-growth signal: type the field to
// link and each SAN materializes a host. Tolerant: unreachable / no-TLS => {}.

const tls = require("tls");

const PORT = 443;
const TIMEOUT_MS = 6000;

module.exports = {
	uses: "tls.cert",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const host = input.host;

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

				if (!cert || !cert.subject) {
					return finish({});
				}

				const sans = String(cert.subjectaltname || "")
					.split(",")
					.map((entry) => {
						return entry.trim().replace(/^DNS:/, "");
					})
					.filter((name) => {
						return name.length > 0 && name.indexOf("*") === -1;
					});

				finish({
					cert_issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN),
					cert_subject: cert.subject.CN,
					cert_not_after: cert.valid_to,
					cert_sans: Array.from(new Set(sans))
				});
			});

			socket.on("error", () => { finish({}); });
			socket.on("timeout", () => { socket.destroy(); finish({}); });
			socket.setTimeout(TIMEOUT_MS);
		});
	}
};
