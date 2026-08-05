const Address4 = require("ip-address").Address4;
const Address6 = require("ip-address").Address6;
const randomIp = require("../index");

// ip-address@10 throws from the constructor on an invalid address, so a
// successful `new AddressN(...)` is itself the validity assertion.
describe("random-ip", () => {
	it("generates IPv6 addresses inside the default owned prefix", () => {
		const generator = randomIp();

		Array(20).fill().forEach(() => {
			const parsed = new Address6(generator.getRandomIP());

			// All default ranges live under 2a0d:f407::/32.
			expect(parsed.canonicalForm().indexOf("2a0d:f407")).toBe(0);
		});
	});

	it("generates IPv4 addresses inside a v4 range", () => {
		const generator = randomIp(["93.184.216.0/24"]);

		Array(20).fill().forEach(() => {
			const address = generator.getRandomIP();

			expect(new Address4(address).isInSubnet(new Address4("93.184.216.0/24"))).toBe(true);
		});
	});

	it("handles mixed families and custom v6 ranges", () => {
		const generator = randomIp(["2001:db8::/48"]);
		const parsed = new Address6(generator.getRandomIP());

		expect(parsed.canonicalForm().indexOf("2001:0db8")).toBe(0);
	});
});
