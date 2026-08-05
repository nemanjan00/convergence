// Self-measure our own outgoing JA3 fingerprint, offline and fully in-memory —
// no listening socket, no port, no network. A TLS client runs over a virtual
// Duplex pair: it writes its ClientHello into an in-memory stream, which we feed
// straight to read-tls-client-hello to compute JA3. The handshake never
// completes (nothing answers) — we only need the client hello.
//
// This is the verification harness for utils/tls-fingerprint: measure what we
// actually send and assert it matches the intended browser.

const tls = require("tls");
const Duplex = require("stream").Duplex;
const PassThrough = require("stream").PassThrough;
const getTlsFingerprintAsJa3 = require("read-tls-client-hello").getTlsFingerprintAsJa3;
const tlsFingerprint = require("../tls-fingerprint");

const ja3 = {
	// Measure the JA3 produced by a TLS client using `ciphers`.
	measure: (ciphers) => {
		return new Promise((resolve, reject) => {
			// Two one-way pipes wired into a virtual socket for the TLS client:
			// it writes to clientToServer and reads from serverToClient (which
			// stays empty — no peer). We only read the ClientHello it emits.
			const clientToServer = new PassThrough();
			const serverToClient = new PassThrough();
			const clientSocket = Duplex.from({
				readable: serverToClient,
				writable: clientToServer
			});

			let client;

			const teardown = () => {
				if (client) {
					client.destroy();
				}

				clientToServer.destroy();
				serverToClient.destroy();
			};

			getTlsFingerprintAsJa3(clientToServer)
				.then((fingerprint) => {
					teardown();
					resolve(fingerprint);
				})
				.catch((error) => {
					teardown();
					reject(error);
				});

			client = tls.connect({
				socket: clientSocket,
				rejectUnauthorized: false,
				ciphers: ciphers
			});

			// Handshake will never complete; the ClientHello is already captured.
			client.on("error", () => {});
		});
	},

	// Measure the JA3 for a named tls-fingerprint browser profile.
	measureProfile: (profileName) => {
		return ja3.measure(tlsFingerprint.cipherString(profileName));
	}
};

module.exports = ja3;
