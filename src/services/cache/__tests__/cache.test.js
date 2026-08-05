const cache = require("../index");

// With no REDIS_URL configured the cache uses its in-memory backend.
describe("cache (in-memory backend)", () => {
	beforeEach(() => {
		cache._reset();
	});

	it("sets and gets", () => {
		return cache.set("k", "v").then(() => {
			return cache.get("k");
		}).then((value) => {
			expect(value).toBe("v");
		});
	});

	it("returns null for a miss", () => {
		return cache.get("missing").then((value) => {
			expect(value).toBeNull();
		});
	});

	it("mget preserves order and nulls for misses", () => {
		return cache.set("a", "1").then(() => {
			return cache.mget(["a", "b"]);
		}).then((values) => {
			expect(values).toEqual(["1", null]);
		});
	});

	it("msetEx writes a batch", () => {
		return cache.msetEx([
			{ key: "x", value: "1" },
			{ key: "y", value: "2" }
		], 60).then(() => {
			return cache.mget(["x", "y"]);
		}).then((values) => {
			expect(values).toEqual(["1", "2"]);
		});
	});

	it("mget of an empty list returns empty", () => {
		return cache.mget([]).then((values) => {
			expect(values).toEqual([]);
		});
	});
});
