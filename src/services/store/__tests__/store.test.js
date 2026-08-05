const store = require("../index");

const provenanceAt = (block, at) => {
	return { block: block, source_item: "x", at: at, raw_ref: null };
};

describe("store", () => {
	beforeEach(() => {
		store._reset();
		store.define("host", { key: ["ip"] });
	});

	it("merges fields from two blocks into one entity by identity", () => {
		store.upsert("host", { ip: "1.2.3.4", registrar: "GoDaddy" },
			provenanceAt("whois", "2026-08-05T10:00:00Z"));
		store.upsert("host", { ip: "1.2.3.4", open_ports: [443] },
			provenanceAt("scan", "2026-08-05T10:05:00Z"));

		const all = store.all("host");

		expect(all).toHaveLength(1);
		expect(all[0].fields.registrar.value).toBe("GoDaddy");
		expect(all[0].fields.open_ports.value).toEqual([443]);
	});

	it("attaches provenance to every field", () => {
		const merged = store.upsert("host", { ip: "1.2.3.4", registrar: "GoDaddy" },
			provenanceAt("whois", "2026-08-05T10:00:00Z"));

		expect(merged.fields.registrar.provenance.block).toBe("whois");
		expect(merged.fields.ip.provenance.block).toBe("whois");
	});

	it("resolves conflicts by last-write-wins on provenance timestamp", () => {
		store.upsert("host", { ip: "1.2.3.4", title: "old" },
			provenanceAt("title", "2026-08-05T10:00:00Z"));
		store.upsert("host", { ip: "1.2.3.4", title: "new" },
			provenanceAt("title", "2026-08-05T11:00:00Z"));

		expect(store.all("host")[0].fields.title.value).toBe("new");
	});

	it("keeps different ips as separate entities", () => {
		store.upsert("host", { ip: "1.1.1.1" }, provenanceAt("resolve", "2026-08-05T10:00:00Z"));
		store.upsert("host", { ip: "2.2.2.2" }, provenanceAt("resolve", "2026-08-05T10:00:00Z"));

		expect(store.all("host")).toHaveLength(2);
		expect(Object.keys(store.allMap("host"))).toHaveLength(2);
	});
});
