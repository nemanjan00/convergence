const host = require("../index");

describe("utils/host", () => {
	it("clean strips a wildcard label and trims", () => {
		expect(host.clean("*.example.com")).toBe("example.com");
		expect(host.clean("  a.example.com  ")).toBe("a.example.com");
		expect(host.clean(undefined)).toBe("");
		expect(host.clean(null)).toBe("");
	});

	it("from picks domain > name > host > target, cleaned", () => {
		expect(host.from({ name: "*.a.com" })).toBe("a.com");
		expect(host.from({ domain: "b.com", name: "ignored.com" })).toBe("b.com");
		expect(host.from({ host: "c.com" })).toBe("c.com");
		expect(host.from({ target: "d.com" })).toBe("d.com");
		expect(host.from({})).toBe("");
	});
});
