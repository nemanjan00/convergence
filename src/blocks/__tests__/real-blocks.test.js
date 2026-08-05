const blocks = require("../index");

// The network blocks are exercised live by `yarn flow`; here we only assert the
// OFFLINE contract that keeps convergence safe: a missing/empty input yields no
// fields (never throws, never blocks the fixpoint). No network is touched.
describe("network blocks — offline tolerance", () => {
	const map = blocks.allMap();

	[
		"dns.a", "dns.aaaa", "dns.txt", "dns.ns", "dns.cname", "dns.caa",
		"port.scan", "http.title", "http.headers", "http.robots",
		"http.security-txt", "http.favicon", "rdap", "ip.asn", "ip.geo",
		"ip.reverse", "tls.cert", "http.paths", "http.json", "mail.mx", "mail.auth"
	].forEach((name) => {
		it(name + " is registered", () => {
			expect(map[name]).toBeDefined();
		});

		it(name + " returns no fields for empty input", () => {
			return map[name].handler({}).then((fields) => {
				expect(fields).toEqual({});
			});
		});
	});
});
