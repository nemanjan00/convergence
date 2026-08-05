const ip = require("../index");

describe("ip", () => {
	it("reports kind", () => {
		expect(ip("93.184.216.34").kind()).toBe("ipv4");
		expect(ip("2606:4700::1").kind()).toBe("ipv6");
	});

	it("masks to a prefix length", () => {
		expect(ip("93.184.216.34").mask(24)).toBe("93.184.216.0");
		expect(ip("93.184.216.34").mask(16)).toBe("93.184.0.0");
		expect(ip("93.184.216.34").mask(32)).toBe("93.184.216.34");
	});

	it("enumerates all containing nets", () => {
		const nets = ip("93.184.216.34").nets();

		expect(nets).toHaveLength(32);
		expect(nets[23]).toBe("93.184.216.0/24");
		expect(nets[31]).toBe("93.184.216.34/32");
	});

	it("reports version helpers", () => {
		expect(ip("1.2.3.4").version()).toBe(4);
		expect(ip("1.2.3.4").isV4()).toBe(true);
		expect(ip("2606:4700::1").isV6()).toBe(true);
	});

	it("tests subnet membership", () => {
		expect(ip("93.184.216.34").isInSubnet("93.184.216.0/24")).toBe(true);
		expect(ip("93.184.217.1").isInSubnet("93.184.216.0/24")).toBe(false);
		// cross-family is never a match
		expect(ip("93.184.216.34").isInSubnet("2606:4700::/32")).toBe(false);
	});

	it("parses a CIDR and answers contains()", () => {
		const range = ip("93.184.216.0/24");

		expect(range.prefix()).toBe(24);
		expect(range.network()).toBe("93.184.216.0");
		expect(range.contains("93.184.216.5")).toBe(true);
		expect(range.contains("93.184.217.5")).toBe(false);
	});

	it("throws contains() on a bare address", () => {
		expect(() => {
			return ip("1.2.3.4").contains("1.2.3.5");
		}).toThrow(/requires a CIDR/);
	});

	it("generates a random address within a CIDR (v4 and v6)", () => {
		Array(20).fill().forEach(() => {
			const v4 = ip("93.184.216.0/24").random();
			expect(ip("93.184.216.0/24").contains(v4)).toBe(true);

			const v6 = ip("2a0d:f407:1006::/48").random();
			expect(ip("2a0d:f407:1006::/48").contains(v6)).toBe(true);
		});
	});

	it("random() on a bare address returns itself", () => {
		expect(ip("93.184.216.34").random()).toBe("93.184.216.34");
	});
});
