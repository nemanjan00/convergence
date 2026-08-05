// Block: cert.parse — parse a PEM certificate you ALREADY have (from a paste, a
// file, a tls.cert capture, a CT log entry) into structured fields. Where
// tls.cert connects to a live host, this is offline: hand it PEM text and get
// issuer / subject / validity / SAN hostnames / fingerprint / SPKI hash back.
// SAN hostnames type -> host and the SPKI sha256 is a cross-host pivot key.
// Pure (node crypto), no network. Tolerant: unparseable PEM => {}.

const X509Certificate = require("crypto").X509Certificate;
const createHash = require("crypto").createHash;

// "DNS:a.com, DNS:b.com, IP Address:1.2.3.4" -> ["a.com", "b.com"]
const sanHosts = (subjectAltName) => {
	if (!subjectAltName) {
		return [];
	}

	return String(subjectAltName).split(",")
		.map((entry) => { return entry.trim(); })
		.filter((entry) => { return entry.indexOf("DNS:") === 0; })
		.map((entry) => { return entry.slice(4); })
		.filter((name) => { return name.indexOf("*") === -1; });
};

module.exports = {
	uses: "cert.parse",
	rate: {},
	handler: (input) => {
		const pem = input.pem || input.cert;

		if (!pem) {
			return Promise.resolve({});
		}

		try {
			const cert = new X509Certificate(String(pem));
			const sans = sanHosts(cert.subjectAltName);

			const fields = {
				cert_subject: cert.subject,
				cert_issuer: cert.issuer,
				cert_not_before: cert.validFrom,
				cert_not_after: cert.validTo,
				cert_fingerprint256: cert.fingerprint256,
				spki_sha256: createHash("sha256").update(cert.publicKey.export({ type: "spki", format: "der" })).digest("hex")
			};

			if (sans.length > 0) {
				fields.cert_sans = sans;
			}

			return Promise.resolve(fields);
		} catch {
			return Promise.resolve({});
		}
	}
};
