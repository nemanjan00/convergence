const balancer = require("../index");

describe("balancer", () => {
	it("returns undefined when empty", () => {
		expect(balancer().getRandomCandidate()).toBeUndefined();
	});

	it("selects deterministically by seed, weighted", () => {
		const pool = balancer();
		pool.push("a", 1);
		pool.push("b", 3);

		// cumulative weight map is [1, 4], max 4.
		expect(pool.getRandomCandidate(0)).toBe("a");
		expect(pool.getRandomCandidate(3)).toBe("b");
		expect(pool.getAllCandidates()).toEqual(["a", "b"]);
	});

	it("removes a candidate and recomputes", () => {
		const pool = balancer();
		pool.push("a", 1);
		pool.push("b", 1);
		pool.delete("a");

		expect(pool.getAllCandidates()).toEqual(["b"]);
		expect(pool.getRandomCandidate(0)).toBe("b");
	});
});
