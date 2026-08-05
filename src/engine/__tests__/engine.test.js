const engineFactory = require("../index");
const store = require("../../services/store");

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
