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
});
