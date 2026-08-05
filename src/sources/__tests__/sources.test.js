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

	it("source.webhook drains pushed items (inbound push ingest)", () => {
		const webhook = sources.allMap()["source.webhook"];

		expect(webhook.push({ address: "9.9.9.9" })).toBe(1);
		expect(webhook.push([{ address: "1.1.1.1" }, "bad", null])).toBe(1);

		return webhook.pull().then((first) => {
			expect(first).toEqual([{ address: "9.9.9.9" }, { address: "1.1.1.1" }]);

			// Drained — a second pull is empty until more is pushed.
			return webhook.pull().then((second) => {
				expect(second).toEqual([]);
			});
		});
	});

	it("source.tick emits a heartbeat with a timestamp", () => {
		const pull = sources.pullFor("source.tick", { label: "beat" });

		return pull().then((items) => {
			expect(items).toHaveLength(1);
			expect(items[0].id).toBe("beat");
			expect(typeof items[0].at).toBe("string");
			expect(typeof items[0].epoch).toBe("number");
		});
	});
});
