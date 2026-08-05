const ja3 = require("../index");

// Offline over a loopback socket; no external network.
describe("ja3 self-measurement", () => {
	it("measures a valid JA3 hash for a profile", () => {
		return ja3.measureProfile("chrome").then((fingerprint) => {
			expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);
		});
	});

	it("different browser profiles yield different JA3s", () => {
		return Promise.all([
			ja3.measureProfile("chrome"),
			ja3.measureProfile("firefox"),
			ja3.measureProfile("node")
		]).then((fingerprints) => {
			const unique = new Set(fingerprints);

			// Proof that Node's cipher ordering actually moves the JA3.
			expect(unique.size).toBe(3);
		});
	});

	it("is stable across measurements", () => {
		return Promise.all([
			ja3.measureProfile("chrome"),
			ja3.measureProfile("chrome")
		]).then((fingerprints) => {
			expect(fingerprints[0]).toBe(fingerprints[1]);
		});
	});
});
