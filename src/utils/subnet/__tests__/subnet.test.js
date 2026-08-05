const subnet = require("../index");

describe("subnet", () => {
	it("lays out VLSM subnets largest-first", () => {
		const result = subnet([50, 20], "10.0.0.0", 24);

		expect(result).toHaveLength(2);

		// 50 hosts needs a /26, placed at the base network.
		expect(result[0].mask).toBe(26);
		expect(result[0].network).toBe("10.0.0.0");
		expect(result[0].firstIP).toBe("10.0.0.1");

		// 20 hosts needs a /27, placed after the first block.
		expect(result[1].mask).toBe(27);
		expect(result[1].network).toBe("10.0.0.64");
	});

	it("orders requirements largest-first regardless of input order", () => {
		const result = subnet([20, 50], "10.0.0.0", 24);

		expect(result[0].computerCount).toBe(50);
		expect(result[1].computerCount).toBe(20);
	});
});
