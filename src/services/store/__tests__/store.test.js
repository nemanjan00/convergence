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

	it("defaults to first-write-wins (monotonic): first value sticks, version settles", () => {
		const a = store.upsert("host", { ip: "1.2.3.4", title: "old" },
			provenanceAt("title", "2026-08-05T10:00:00Z"));
		const b = store.upsert("host", { ip: "1.2.3.4", title: "new" },
			provenanceAt("title", "2026-08-05T11:00:00Z"));

		expect(store.all("host")[0].fields.title.value).toBe("old");
		// no real change on the second write => version does not move (converges)
		expect(b._version).toBe(a._version);
	});

	it("keeps different ips as separate entities", () => {
		store.upsert("host", { ip: "1.1.1.1" }, provenanceAt("resolve", "2026-08-05T10:00:00Z"));
		store.upsert("host", { ip: "2.2.2.2" }, provenanceAt("resolve", "2026-08-05T10:00:00Z"));

		expect(store.all("host")).toHaveLength(2);
		expect(Object.keys(store.allMap("host"))).toHaveLength(2);
	});
});

describe("store merge strategies", () => {
	beforeEach(() => {
		store._reset();
	});

	it("last-write-wins updates the value on a newer write", () => {
		store.define("host", { key: ["ip"], merge: "last-write-wins-with-provenance" });
		store.upsert("host", { ip: "1.2.3.4", title: "old" }, provenanceAt("t", "2026-08-05T10:00:00Z"));
		store.upsert("host", { ip: "1.2.3.4", title: "new" }, provenanceAt("t", "2026-08-05T11:00:00Z"));

		expect(store.get("host", "ip=\"1.2.3.4\"").fields.title.value).toBe("new");
	});

	it("union accumulates distinct values and settles when nothing is new", () => {
		store.define("obs", { key: ["host"], merge: "union-with-provenance" });
		store.upsert("obs", { host: "a", ports: [80] }, provenanceAt("scan1", "2026-08-05T10:00:00Z"));
		store.upsert("obs", { host: "a", ports: [443] }, provenanceAt("scan2", "2026-08-05T10:05:00Z"));
		const third = store.upsert("obs", { host: "a", ports: [80] }, provenanceAt("scan3", "2026-08-05T10:10:00Z"));

		expect(store.get("obs", "host=\"a\"").fields.ports.value.sort()).toEqual([443, 80]);
		// re-adding an existing value is a no-op => version stops moving
		expect(third._version).toBe(2);
	});
});

describe("store typed-field auto-linking", () => {
	beforeEach(() => {
		store._reset();
	});

	it("materializes a linked entity + edge when a typed field is written", () => {
		store.define("ip", { key: ["address"] });
		store.define("host", {
			key: ["name"],
			fields: { ip: { links: "ip", as: "address", rel: "resolves_to" } }
		});

		store.upsert("host", { name: "a.com", ip: "1.2.3.4" }, provenanceAt("resolve", "t"));

		const ips = store.all("ip");
		expect(ips).toHaveLength(1);
		expect(ips[0].fields.address.value).toBe("1.2.3.4");

		const edges = store.edges({ fromType: "host" });
		expect(edges).toHaveLength(1);
		expect(edges[0].rel).toBe("resolves_to");
		expect(edges[0].to.type).toBe("ip");
	});

	it("does not re-link on a no-op re-write (idempotent)", () => {
		store.define("ip", { key: ["address"] });
		store.define("host", { key: ["name"], fields: { ip: { links: "ip", as: "address" } } });

		store.upsert("host", { name: "a.com", ip: "1.2.3.4" }, provenanceAt("resolve", "t1"));
		store.upsert("host", { name: "a.com", ip: "1.2.3.4" }, provenanceAt("resolve", "t2"));

		expect(store.all("ip")).toHaveLength(1);
		expect(store.edges()).toHaveLength(1);
	});
});

describe("store edges", () => {
	beforeEach(() => {
		store._reset();
	});

	it("records and queries deduped lineage edges", () => {
		const edge = {
			from: { type: "cert", key: "id=1" },
			rel: "has_san",
			to: { type: "host", key: "name=\"a.com\"" },
			via: "fanout",
			at: "2026-08-05T10:00:00Z"
		};

		store.addEdge(edge);
		store.addEdge(edge); // duplicate ignored

		expect(store.edges()).toHaveLength(1);
		expect(store.edges({ fromType: "cert", fromKey: "id=1" })).toHaveLength(1);
		expect(store.edges({ toKey: "name=\"nope\"" })).toHaveLength(0);
	});
});

describe("store.scope — per-playbook namespacing", () => {
	beforeEach(() => {
		store._reset();
	});

	it("keeps identical identities in different playbooks as SEPARATE entities", () => {
		const a = store.scope("pb-a");
		const b = store.scope("pb-b");

		a.define("host", { key: ["ip"] });
		b.define("host", { key: ["ip"] });

		// The same discovery (1.1.1.1) shows up in two unrelated playbooks.
		a.upsert("host", { ip: "1.1.1.1", tag: "from-a" }, provenanceAt("s", "t1"));
		b.upsert("host", { ip: "1.1.1.1", tag: "from-b" }, provenanceAt("s", "t1"));

		// Each playbook sees ONLY its own — no bleed (the phantom-entity bug).
		expect(a.all("host")).toHaveLength(1);
		expect(b.all("host")).toHaveLength(1);
		expect(a.all("host")[0].fields.tag.value).toBe("from-a");
		expect(b.all("host")[0].fields.tag.value).toBe("from-b");

		// The raw store holds them under distinct namespaced collection keys.
		expect(Object.keys(store._collections).sort()).toEqual(["pb-a::host", "pb-b::host"]);
		expect(store.splitKey("pb-a::host")).toEqual({ playbook: "pb-a", type: "host" });
	});

	it("auto-links typed fields and edges WITHIN the playbook namespace", () => {
		const a = store.scope("pb-a");

		a.define("host", { key: ["name"], fields: { ip: { links: "ip", rel: "resolves_to" } } });
		a.define("ip", { key: ["ip"] });
		a.upsert("host", { name: "a.com", ip: "9.9.9.9" }, provenanceAt("dns", "t1"));

		// The linked ip entity lands in pb-a's namespace, and the edge reads back
		// in BARE types (the prefix is an implementation detail).
		expect(a.all("ip")).toHaveLength(1);
		const edges = a.edges({ fromType: "host" });
		expect(edges).toHaveLength(1);
		expect(edges[0].from.type).toBe("host");
		expect(edges[0].to.type).toBe("ip");

		// A different playbook shares none of it.
		expect(store.scope("pb-b").all("ip")).toHaveLength(0);
	});

	it("a falsy playbook yields the unscoped store", () => {
		expect(store.scope(null)).toBe(store);
		expect(store.scope(undefined)).toBe(store);
	});
});
