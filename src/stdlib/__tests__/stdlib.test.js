const stdlib = require("../index");

// Enforces the dependency-layer invariant: the stdlib (and the pure helpers it
// re-exports) must be frontend-shippable, so it must NOT transitively pull in
// server-only dependencies. Jest gives each test file its own module registry,
// so require.cache here reflects only what stdlib loaded.
const SERVER_ONLY = ["ioredis", "mongodb", "mongoose", "got-verbose", "got"];

describe("stdlib (frontend-safe surface)", () => {
	it("exposes exactly the curated helpers", () => {
		expect(Object.keys(stdlib).sort()).toEqual(["balancer", "geo", "ip", "mmh3", "subnet"]);
	});

	// Known Python-mmh3 / Shodan vectors — mmh3 must match bit-for-bit so a
	// favicon_hash we compute equals one from a `http.favicon.hash:` query.
	it("mmh3 matches canonical MurmurHash3 x86_32 vectors", () => {
		expect(stdlib.mmh3("")).toBe(0);
		expect(stdlib.mmh3("foo")).toBe(-156908512);
		expect(stdlib.mmh3("hello")).toBe(613153351);
	});

	it("mmh3 hashes Buffers identically to their string form", () => {
		expect(stdlib.mmh3(Buffer.from("hello", "utf8"))).toBe(stdlib.mmh3("hello"));
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
