const ipCountry = require("../index");

// Uses the bundled sample dataset (data/rir-ip-sample).
describe("ip-country", () => {
	it("maps an IPv4 address to its country", () => {
		expect(ipCountry.getCountry("93.184.216.34").country_code).toBe("US");
		expect(ipCountry.getCountry("85.214.1.1").country_code).toBe("DE");
	});

	it("returns the matching range", () => {
		expect(ipCountry.getRange("93.184.216.34")).toBe("93.184.216.0/24");
	});

	it("maps an IPv6 address to its country", () => {
		expect(ipCountry.getCountry("2606:4700::1").country_code).toBe("US");
	});

	it("returns false for an unknown address", () => {
		expect(ipCountry.getCountry("1.2.3.4")).toBe(false);
		expect(ipCountry.getRange("1.2.3.4")).toBe(false);
	});
});
