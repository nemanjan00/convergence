const http = require("../index");
const tlsFingerprint = require("../../../utils/tls-fingerprint");

// Offline: the egress client picks a TLS cipher order that MATCHES the UA's
// browser family, so the JA3 agrees with the User-Agent. (The JA3 those ciphers
// actually produce is asserted in utils/ja3's tests.)
describe("services/http egress shaping", () => {
	it("uses Chrome ciphers for a Chrome UA", () => {
		const ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

		expect(http.ciphersFor(ua)).toBe(tlsFingerprint.cipherString("chrome"));
	});

	it("uses Firefox ciphers for a Firefox UA", () => {
		const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";

		expect(http.ciphersFor(ua)).toBe(tlsFingerprint.cipherString("firefox"));
	});

	it("always produces a non-empty user agent", () => {
		expect(typeof http.userAgent()).toBe("string");
		expect(http.userAgent().length).toBeGreaterThan(10);
	});
});
