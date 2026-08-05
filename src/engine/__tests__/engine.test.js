const engineFactory = require("../index");
const store = require("../../services/store");
const journal = require("../../services/journal");

// A block handler is input => Promise<fields>.
const constantBlock = (fields) => {
	return () => {
		return Promise.resolve(fields);
	};
};

// Convergence-native flow: one `host` entity keyed by a stable name, seeded
// WITHOUT an ip. resolve adds the ip; that state change makes scan's guard pass;
// scan's ports make title's guard pass. The cascade happens purely because the
// entity's state converges — no ordering is authored.
const buildFlow = () => {
	return {
		name: "converge-test",
		entities: {
			host: { key: ["name"], merge: "last-write-wins-with-provenance" }
		},
		source: {
			id: "seed",
			emits: "host",
			filter: undefined,
			pull: () => {
				return Promise.resolve([{ name: "a.example.com" }, { name: "b.example.com" }]);
			}
		},
		blocks: [
			{
				id: "resolve",
				uses: "dns.resolve",
				forEach: "host",
				when: { "host.ip": { $exists: false } },
				inputs: (ctx) => ({ name: ctx.host.name }),
				mergeInto: "host"
			},
			{
				id: "scan",
				uses: "port.scan",
				forEach: "host",
				when: { "host.ip": { $ne: null } },
				inputs: (ctx) => ({ target: ctx.host.ip }),
				mergeInto: "host"
			},
			{
				id: "title",
				uses: "http.title",
				forEach: "host",
				when: { "host.open_ports": { $in: [80, 443] } },
				inputs: (ctx) => ({ ip: ctx.host.ip }),
				mergeInto: "host"
			}
		]
	};
};

const register = (engine) => {
	engine.registerBlock("dns.resolve", constantBlock({ ip: "1.2.3.4" }));
	engine.registerBlock("port.scan", constantBlock({ open_ports: [80, 443] }));
	engine.registerBlock("http.title", constantBlock({ title: "Example" }));
};

describe("convergence engine", () => {
	beforeEach(() => {
		store._reset();
		journal._reset();
	});

	it("journals every block execution (observable run: input/output/changed/timing)", () => {
		const engine = engineFactory.create();
		register(engine);

		return engine.run(buildFlow()).then(() => {
			const entries = journal.all();

			expect(entries.length).toBeGreaterThan(0);

			// A successful enrichment is recorded with its produced output and a
			// changed flag the first time it writes.
			const resolveOk = entries.find((entry) => {
				return entry.block === "resolve" && entry.status === "ok" &&
					entry.entity.key === "name=\"a.example.com\"";
			});

			expect(resolveOk).toBeDefined();
			expect(resolveOk.uses).toBe("dns.resolve");
			expect(resolveOk.changed).toBe(true);
			expect(resolveOk.output.ip).toBe("1.2.3.4");
			expect(typeof resolveOk.duration_ms).toBe("number");
			expect(resolveOk.sweep).toBeGreaterThanOrEqual(1);

			// Guard-blocked attempts are recorded too (status "skipped"), which is
			// how the panel shows "this block didn't run, and why".
			const skipped = entries.filter((entry) => { return entry.status === "skipped"; });
			expect(skipped.length).toBeGreaterThan(0);
		});
	});

	it("cascades via entity-state convergence: seed -> resolve -> scan -> title", () => {
		const engine = engineFactory.create();
		register(engine);

		return engine.run(buildFlow()).then(() => {
			const hosts = store.all("host");

			expect(hosts).toHaveLength(2);

			const a = store.get("host", "name=\"a.example.com\"");
			expect(a.fields.ip.value).toBe("1.2.3.4");
			expect(a.fields.open_ports.value).toEqual([80, 443]);
			expect(a.fields.title.value).toBe("Example");

			// Each field is credited to the block that produced it.
			expect(a.fields.ip.provenance.block).toBe("resolve");
			expect(a.fields.open_ports.provenance.block).toBe("scan");
			expect(a.fields.title.provenance.block).toBe("title");
		});
	});

	it("does not fire a block whose guard never becomes satisfied", () => {
		const engine = engineFactory.create();
		// resolve produces no ip, so scan/title guards never pass.
		engine.registerBlock("dns.resolve", constantBlock({ note: "no-ip" }));
		engine.registerBlock("port.scan", constantBlock({ open_ports: [80] }));
		engine.registerBlock("http.title", constantBlock({ title: "x" }));

		return engine.run(buildFlow()).then(() => {
			const a = store.get("host", "name=\"a.example.com\"");

			expect(a.fields.open_ports).toBeUndefined();
			expect(a.fields.title).toBeUndefined();
		});
	});

	it("self-feeding crawler converges over a cyclic site and terminates", () => {
		// A tiny site graph with a cycle (a<->b) and a leaf (c). The crawler emits
		// each page's links as `crawl_links`, typed to materialize a webpage per
		// URL — so the ENGINE walks the site. URL identity + first-write-wins must
		// make it dedupe and STOP, not loop on the a<->b cycle.
		const SITE = {
			"http://s/a": ["http://s/b", "http://s/c"],
			"http://s/b": ["http://s/a"],
			"http://s/c": []
		};

		const engine = engineFactory.create();
		engine.registerBlock("crawl", (input) => {
			return Promise.resolve({ crawl_links: SITE[input.url] || [] });
		});

		const flow = {
			name: "crawl-test",
			entities: {
				webpage: {
					key: ["url"],
					merge: "first-write-wins-with-provenance",
					fields: { crawl_links: { links: "webpage", as: "url", rel: "links_to" } }
				}
			},
			source: {
				id: "seed",
				emits: "webpage",
				pull: () => { return Promise.resolve([{ url: "http://s/a" }]); }
			},
			blocks: [
				{
					id: "crawl",
					uses: "crawl",
					forEach: "webpage",
					inputs: (ctx) => ({ url: ctx.webpage.url }),
					mergeInto: "webpage"
				}
			]
		};

		// If it didn't dedupe, run() would throw "did not converge"; reaching here
		// with all three pages proves the self-feed terminates.
		return engine.run(flow).then(() => {
			const urls = store.all("webpage").map((page) => { return page._identity; }).sort();

			expect(urls).toEqual([
				"url=\"http://s/a\"", "url=\"http://s/b\"", "url=\"http://s/c\""
			]);

			// a -> b, a -> c, b -> a : three lineage edges, no runaway.
			expect(store.edges({ fromType: "webpage" })).toHaveLength(3);
		});
	});

	it("terminates (reaches a fixpoint) and is idempotent on re-run", () => {
		const engine = engineFactory.create();
		register(engine);
		const flow = buildFlow();

		return engine.run(flow).then(() => {
			const versionAfterFirst = store.get("host", "name=\"a.example.com\"")._version;

			// Running again must not keep bumping versions (no-op writes settle).
			return engine.run(flow).then(() => {
				expect(store.get("host", "name=\"a.example.com\"")._version).toBe(versionAfterFirst);
			});
		});
	});
});
