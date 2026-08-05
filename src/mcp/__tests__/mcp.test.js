const mcp = require("../index");
const store = require("../../services/store");

describe("mcp capability layer", () => {
	it("lists the block library and sources", () => {
		const lib = mcp.listBlocks();
		const uses = lib.blocks.map((b) => b.uses);

		expect(uses).toContain("ip.country");
		expect(uses).toContain("dns.a");
		expect(lib.sources.map((s) => s.source)).toContain("source.ct-log");
	});

	it("validates a good flow and reports errors for a bad one", () => {
		const good = "apiVersion: v0\nkind: Flow\nmetadata: { name: t }\n" +
			"entities: { host: { key: [name] } }\n" +
			"sources: [{ id: s, block: source.ct-log, emits: host }]\n" +
			"blocks: [{ id: r, uses: dns.a, for_each: host, merge_into: host, inputs: { name: \"{{ host.name }}\" } }]\n";

		expect(mcp.validateFlow(good).valid).toBe(true);
		expect(mcp.validateFlow("apiVersion: v9\nmetadata: {}\n").valid).toBe(false);
	});

	it("queries entities with a sift filter (TQL analog)", () => {
		store._reset();
		store.define("host", { key: ["name"] });
		const prov = { block: "scan", source_item: null, at: "t", raw_ref: null };
		store.upsert("host", { name: "a", open_ports: [80, 443] }, prov);
		store.upsert("host", { name: "b", open_ports: [22] }, prov);

		const result = mcp.queryEntities({
			entityType: "host",
			query: { open_ports: { $in: [443] } },
			select: ["_key", "open_ports"]
		});

		expect(result.row_count).toBe(1);
		expect(result.rows[0]._key).toBe("name=\"a\"");
		expect(result.columns).toEqual(["_key", "open_ports"]);
	});

	it("runs a flow to convergence and returns rows (offline)", () => {
		store._reset();

		const yaml = "apiVersion: v0\nkind: Flow\nmetadata: { name: q }\n" +
			"entities: { host: { key: [ip] } }\n" +
			"sources: [{ id: seed, block: source.ct-log, emits: host }]\n" +
			"blocks: [{ id: country, uses: ip.country, for_each: host, merge_into: host, inputs: { ip: \"{{ host.ip }}\" } }]\n";

		return mcp.runFlow(yaml, {
			sourcePull: () => {
				return Promise.resolve([{ ip: "93.184.216.34" }]);
			}
		}).then((result) => {
			expect(result.entities.host).toHaveLength(1);
			expect(result.entities.host[0].country_code).toBe("US");
		});
	});

	it("scopes entities per playbook — two playbooks with the same host don't bleed", () => {
		store._reset();

		const yaml = "apiVersion: v0\nkind: Flow\nmetadata: { name: q }\n" +
			"entities: { host: { key: [ip] } }\n" +
			"sources: [{ id: seed, block: source.ct-log, emits: host }]\n" +
			"blocks: [{ id: country, uses: ip.country, for_each: host, merge_into: host, inputs: { ip: \"{{ host.ip }}\" } }]\n";

		const run = (playbookId, ip) => {
			return mcp.runFlow(yaml, { playbookId: playbookId, sourcePull: () => { return Promise.resolve([{ ip: ip }]); } });
		};

		// pb-1 discovers one host; pb-2 discovers the SAME identity plus another.
		return run("pb-1", "93.184.216.34")
			.then(() => { return run("pb-2", "93.184.216.34"); })
			.then(() => { return run("pb-2", "8.8.8.8"); })
			.then(() => {
				// Each playbook's query returns only its own entities.
				expect(mcp.queryEntities({ entityType: "host", playbook: "pb-1" }).row_count).toBe(1);
				expect(mcp.queryEntities({ entityType: "host", playbook: "pb-2" }).row_count).toBe(2);
				// The raw (unscoped) query sees neither — types are namespaced.
				expect(mcp.queryEntities({ entityType: "host" }).row_count).toBe(0);
			});
	});
});
