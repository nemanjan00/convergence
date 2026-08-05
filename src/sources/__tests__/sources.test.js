const sources = require("../index");

describe("sources registry", () => {
	it("exposes a source -> module map", () => {
		expect(sources.allMap()["source.ct-log"]).toBeDefined();
	});

	it("binds a pull() for a known source", () => {
		const pull = sources.pullFor("source.ct-log", { match_domains: [] });

		expect(typeof pull).toBe("function");

		// No domains -> resolves to an empty batch without touching the network.
		return pull().then((items) => {
			expect(items).toEqual([]);
		});
	});

	it("returns null for an unknown source", () => {
		expect(sources.pullFor("source.nope", {})).toBeNull();
	});

	it("source.list emits provided items verbatim (ingest)", () => {
		const items = [{ address: "1.1.1.1", tag: "c2" }, { address: "8.8.8.8" }];
		const pull = sources.pullFor("source.list", { items: items });

		return pull().then((emitted) => {
			expect(emitted).toEqual(items);
		});
	});
});
