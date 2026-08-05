// TLS client-hello fingerprint shaping. To avoid JA3-based bot blocking, an
// outbound request should look like a REAL browser — not a novel random
// fingerprint (a random JA3 behind a Chrome User-Agent is itself a tell). Node
// can't reorder TLS extensions, but it can order the TLS 1.3 ciphers to match a
// specific browser's known client hello, which shifts the JA3 toward that
// browser and defeats blocklist-based blocking.
//
// For a PERFECT match (extension order included) use bogdanfinn/tls-client
// (Go/uTLS) as a sidecar — that is the escalation when a target blocklists by
// exact JA3. This helper is the zero-native-dep first line and pairs with
// utils/useragent so the UA and the TLS profile name the same browser.

const tls = require("tls");

// Known leading TLS 1.3 cipher orders per browser (see HTTP Toolkit research).
// #1 TLS_AES_256_GCM_SHA384, #2 TLS_CHACHA20_POLY1305_SHA256, #3 TLS_AES_128_GCM_SHA256
const PROFILES = {
	chrome: [
		"TLS_AES_128_GCM_SHA256",
		"TLS_AES_256_GCM_SHA384",
		"TLS_CHACHA20_POLY1305_SHA256"
	],
	firefox: [
		"TLS_AES_128_GCM_SHA256",
		"TLS_CHACHA20_POLY1305_SHA256",
		"TLS_AES_256_GCM_SHA384"
	],
	// Node's own default order; useful as an explicit "no spoof" choice.
	node: [
		"TLS_AES_256_GCM_SHA384",
		"TLS_CHACHA20_POLY1305_SHA256",
		"TLS_AES_128_GCM_SHA256"
	]
};

const DEFAULT_PROFILE = "chrome";

const tlsFingerprint = {
	profiles: () => {
		return Object.keys(PROFILES);
	},

	// Colon-separated cipher string with the TLS 1.3 ciphers ordered to match
	// the named browser, and every other cipher / security exclusion preserved.
	cipherString: (profileName) => {
		const order = PROFILES[profileName] || PROFILES[DEFAULT_PROFILE];
		const defaults = tls.DEFAULT_CIPHERS.split(":");

		// TLS 1.3 ciphers present in Node's defaults, and everything else.
		const present = order.filter((cipher) => {
			return defaults.indexOf(cipher) !== -1;
		});
		const rest = defaults.filter((cipher) => {
			return cipher.indexOf("TLS_") !== 0;
		});

		return present.concat(rest).join(":");
	},

	// An https.Agent preconfigured with the browser-shaped cipher order.
	agent: (profileName) => {
		const https = require("https");

		return new https.Agent({ ciphers: tlsFingerprint.cipherString(profileName) });
	},

	// Choose a profile consistent with a User-Agent string (so the JA3 and the
	// UA agree on the browser).
	forUserAgent: (userAgent) => {
		if (/firefox/i.test(userAgent)) {
			return tlsFingerprint.cipherString("firefox");
		}

		return tlsFingerprint.cipherString("chrome");
	}
};

module.exports = tlsFingerprint;
