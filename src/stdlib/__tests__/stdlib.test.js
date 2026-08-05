const stdlib = require("../index");

// Enforces the dependency-layer invariant: the stdlib (and the pure helpers it
// re-exports) must be frontend-shippable, so it must NOT transitively pull in
// server-only dependencies. Jest gives each test file its own module registry,
// so require.cache here reflects only what stdlib loaded.
const SERVER_ONLY = ["ioredis", "mongodb", "mongoose", "got-verbose", "got"];

describe("stdlib (frontend-safe surface)", () => {
	it("exposes exactly the curated helpers", () => {
		expect(Object.keys(stdlib).sort()).toEqual(["balancer", "geo", "ip", "subnet"]);
	});

	it("does not transitively load any server-only dependency", () => {
		const loaded = Object.keys(require.cache);

		SERVER_ONLY.forEach((dep) => {
			const hit = loaded.some((modulePath) => {
				return modulePath.indexOf("/node_modules/" + dep + "/") !== -1;
			});

			expect(hit).toBe(false);
		});
	});
});
