const blocks = require("../index");

// The network blocks are exercised live by `yarn flow`; here we only assert the
// OFFLINE contract that keeps convergence safe: a missing/empty input yields no
// fields (never throws, never blocks the fixpoint). No network is touched.
describe("network blocks — offline tolerance", () => {
	const map = blocks.allMap();

	["dns.a", "port.scan", "http.title", "rdap", "ip.asn", "ip.geo", "ip.reverse", "mail.mx", "mail.auth"].forEach((name) => {
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
