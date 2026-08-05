// Block: tls.cert — connect to host:443, read the live server certificate, and
// extract issuer / subject / expiry / SAN hostnames AND any email addresses the
// cert carries (subject emailAddress or SAN rfc822/email: entries). Both are
// graph-growth signals: type `cert_sans` to link -> host, `cert_emails` to link
// -> email. crt.sh-independent. Tolerant: unreachable / no-TLS => {}.

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

				// One parse, several typed outputs: SAN hostnames and any emails
				// the cert carries (SAN rfc822 / subject emailAddress).
				const altNames = String(cert.subjectaltname || "").split(",").map((entry) => {
					return entry.trim();
				});

				const sans = altNames
					.filter((entry) => { return entry.indexOf("DNS:") === 0; })
					.map((entry) => { return entry.slice(4); })
					.filter((name) => { return name.length > 0 && name.indexOf("*") === -1; });

				const emails = altNames
					.filter((entry) => { return entry.indexOf("email:") === 0; })
					.map((entry) => { return entry.slice(6); });

				if (cert.subject.emailAddress) {
					emails.push(cert.subject.emailAddress);
				}

				const fields = {
					cert_issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN),
					cert_subject: cert.subject.CN,
					cert_not_after: cert.valid_to,
					cert_sans: Array.from(new Set(sans))
				};

				if (emails.length > 0) {
					fields.cert_emails = Array.from(new Set(emails));
				}

				finish(fields);
			});

			socket.on("error", () => { finish({}); });
			socket.on("timeout", () => { socket.destroy(); finish({}); });
			socket.setTimeout(TIMEOUT_MS);
		});
	}
};
