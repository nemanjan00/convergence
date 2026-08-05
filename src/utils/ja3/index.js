// Self-measure our own outgoing JA3 fingerprint, offline. Stands up a loopback
// TCP server, has a TLS client connect to it with the given cipher config, taps
// the raw ClientHello on the server side (before any handshake), and computes
// JA3 via read-tls-client-hello. No external service, no completed handshake —
// we only need the client hello.
//
// This is the verification harness for utils/tls-fingerprint: measure what we
// actually send and assert it matches the intended browser.

const net = require("net");
const tls = require("tls");
const getTlsFingerprintAsJa3 = require("read-tls-client-hello").getTlsFingerprintAsJa3;
const tlsFingerprint = require("../tls-fingerprint");

const ja3 = {
	// Measure the JA3 produced by a TLS client using `ciphers`.
	measure: (ciphers) => {
		return new Promise((resolve, reject) => {
			const server = net.createServer((socket) => {
				getTlsFingerprintAsJa3(socket)
					.then((fingerprint) => {
						socket.destroy();
						server.close();
						resolve(fingerprint);
					})
					.catch((error) => {
						socket.destroy();
						server.close();
						reject(error);
					});
			});

			server.on("error", reject);

			server.listen(0, "127.0.0.1", () => {
				const port = server.address().port;
				const client = tls.connect({
					host: "127.0.0.1",
					port: port,
					ciphers: ciphers,
					rejectUnauthorized: false
				});

				// The handshake will not complete (the server never speaks TLS);
				// the ClientHello is already captured, so swallow the error.
				client.on("error", () => {});
			});
		});
	},

	// Measure the JA3 for a named tls-fingerprint browser profile.
	measureProfile: (profileName) => {
		return ja3.measure(tlsFingerprint.cipherString(profileName));
	}
};

module.exports = ja3;
