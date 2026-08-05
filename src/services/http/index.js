// Impersonating HTTP egress. One place that makes outbound recon requests look
// like a real browser: a rotated real User-Agent (utils/useragent) AND a
// matching TLS client-hello cipher order (utils/tls-fingerprint) so the JA3
// agrees with the UA — a random JA3 behind a Chrome UA is itself a tell. See
// docs/EGRESS.md.
//
// Uses got (via got-verbose, CJS) so we can set `https.ciphers`; Node's global
// fetch can't shape the client hello. Tolerant callers handle rejections.
//
// TODO: egress-IP rotation (bind source to utils/ip.randomFrom over owned
// ranges); tls-client (uTLS) sidecar transport for exact-JA3 targets.

const got = require("got-verbose");
const tlsFingerprint = require("../../utils/tls-fingerprint");

const DEFAULT_TIMEOUT_MS = 6000;

const STATIC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const http = {
	// A realistic UA (rotated via the ported useragent util; static fallback).
	userAgent: () => {
		try {
			return require("../../utils/useragent").getRandomUseragent() || STATIC_UA;
		} catch {
			return STATIC_UA;
		}
	},

	// The TLS cipher order that matches a given UA's browser family. Exposed so
	// the JA3 it produces can be asserted (see utils/ja3 + tests).
	ciphersFor: (userAgent) => {
		return tlsFingerprint.forUserAgent(userAgent);
	},

	// GET a URL as a browser would. Resolves { status, headers, body } (never
	// throws on HTTP status); rejects only on transport failure/timeout.
	get: (url, options) => {
		const opts = options || {};
		const ua = opts.userAgent || http.userAgent();

		return got(url, {
			method: "GET",
			headers: Object.assign({ "user-agent": ua }, opts.headers || {}),
			https: { ciphers: http.ciphersFor(ua) },
			timeout: { request: opts.timeout || DEFAULT_TIMEOUT_MS },
			followRedirect: true,
			throwHttpErrors: false,
			retry: { limit: opts.retry || 0 }
		}).then((response) => {
			return {
				status: response.statusCode,
				headers: response.headers,
				body: response.body
			};
		});
	}
};

module.exports = http;
