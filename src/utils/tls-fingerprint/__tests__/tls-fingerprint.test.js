const tls = require("tls");
const tlsFingerprint = require("../index");

describe("tls-fingerprint", () => {
	it("orders TLS 1.3 ciphers to match Chrome", () => {
		const ciphers = tlsFingerprint.cipherString("chrome").split(":");

		expect(ciphers[0]).toBe("TLS_AES_128_GCM_SHA256");
		expect(ciphers[1]).toBe("TLS_AES_256_GCM_SHA384");
		expect(ciphers[2]).toBe("TLS_CHACHA20_POLY1305_SHA256");
	});

	it("produces a different order for Firefox", () => {
		expect(tlsFingerprint.cipherString("firefox"))
			.not.toBe(tlsFingerprint.cipherString("chrome"));

		expect(tlsFingerprint.cipherString("firefox").split(":")[1])
			.toBe("TLS_CHACHA20_POLY1305_SHA256");
	});

	it("preserves the non-TLS1.3 ciphers from Node's defaults", () => {
		const shaped = tlsFingerprint.cipherString("chrome").split(":");
		const defaults = tls.DEFAULT_CIPHERS.split(":");
		const nonTls13 = defaults.filter((cipher) => {
			return cipher.indexOf("TLS_") !== 0;
		});

		nonTls13.forEach((cipher) => {
			expect(shaped).toContain(cipher);
		});
	});

	it("picks a profile consistent with the User-Agent", () => {
		const ffUa = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";
		const chromeUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

		expect(tlsFingerprint.forUserAgent(ffUa)).toBe(tlsFingerprint.cipherString("firefox"));
		expect(tlsFingerprint.forUserAgent(chromeUa)).toBe(tlsFingerprint.cipherString("chrome"));
	});
});
