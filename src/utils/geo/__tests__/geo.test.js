const geo = require("../index");

describe("geo", () => {
	it("finds the nearest available country", () => {
		// Serbia is far closer to Germany than to the US or Singapore.
		expect(geo.findNearestCountry("RS", ["US", "DE", "SG"])).toBe("DE");
	});

	it("ignores unknown available countries", () => {
		expect(geo.findNearestCountry("RS", ["eu", "DE"])).toBe("DE");
	});

	it("falls back to the first known country when the given one is unknown", () => {
		expect(geo.findNearestCountry("XX", ["US", "DE"])).toBe("US");
	});
});
