const crtsh = require("../index");

// Offline test of the row -> cert mapping (the network `search` is not tested
// here). Fixture mirrors crt.sh's JSON output shape.
describe("crtsh._map", () => {
	it("maps crt.sh rows to cert entities with split SANs", () => {
		const rows = [
			{
				id: 123,
				common_name: "example.com",
				name_value: "example.com\nwww.example.com\napi.example.com",
				issuer_name: "C=US, O=Let's Encrypt, CN=R3",
				not_before: "2026-01-01T00:00:00",
				not_after: "2026-04-01T00:00:00",
				serial_number: "abcd"
			}
		];

		const certs = crtsh._map(rows);

		expect(certs).toHaveLength(1);
		expect(certs[0].id).toBe(123);
		expect(certs[0].san).toEqual(["example.com", "www.example.com", "api.example.com"]);
		expect(certs[0].issuer).toMatch(/Let's Encrypt/);
		expect(certs[0].is_precert).toBe(false);
	});

	it("drops empty SAN lines", () => {
		const certs = crtsh._map([{ id: 1, name_value: "a.com\n\n" }]);

		expect(certs[0].san).toEqual(["a.com"]);
	});
});
