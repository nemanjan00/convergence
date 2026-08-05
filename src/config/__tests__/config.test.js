const config = require("../index");

describe("config", () => {
	it("returns default when env var is unset", () => {
		delete process.env.MONGO_DB;

		expect(config.get("MONGO_DB")).toBe("convergence");
	});

	it("prefers env var over default", () => {
		process.env.MONGO_DB = "custom";

		expect(config.get("MONGO_DB")).toBe("custom");

		delete process.env.MONGO_DB;
	});

	it("coerces numeric values", () => {
		expect(config.getNumber("QUEUE_CAPACITY")).toBe(1000);
	});
});
