const blocks = require("../index");
const engineFactory = require("../../engine");
const store = require("../../services/store");

describe("built-in blocks", () => {
	beforeEach(() => {
		store._reset();
	});

	it("exposes a uses -> block map", () => {
		expect(blocks.allMap()["ip.country"]).toBeDefined();
	});

	it("register() forwards each block's declared rate limits to the runtime", () => {
		// Regression guard: blocks declare camelCase rate:{maxConcurrent,maxPerMin};
		// a snake_case read here silently dropped ALL rate tuning.
		const seen = {};
		const fakeRuntime = {
			registerBlock: (uses, handler, opts) => { seen[uses] = opts; }
		};

		blocks.register(fakeRuntime);

		// rdap declares maxPerMin:120; a DNS block declares maxConcurrent:20.
		expect(seen["rdap"].maxPerMin).toBe(120);
		expect(seen["dns.a"].maxConcurrent).toBe(20);
	});

	it("ip.country attaches country_code from an IP, offline", () => {
		return blocks.allMap()["ip.country"].handler({ ip: "93.184.216.34" })
			.then((fields) => {
				expect(fields.country_code).toBe("US");
			});
	});

	it("ip.country returns no fields for an unknown IP", () => {
		return blocks.allMap()["ip.country"].handler({ ip: "1.2.3.4" })
			.then((fields) => {
				expect(fields).toEqual({});
			});
	});

	it("registers into the engine and runs in a flow", () => {
		const engine = engineFactory.create();
		blocks.register(engine);

		const flow = {
			name: "country-test",
			entities: { host: { key: ["ip"], merge: "last-write-wins-with-provenance" } },
			source: {
				id: "seed",
				emits: "host",
				pull: () => {
					return Promise.resolve([{ ip: "93.184.216.34" }]);
				}
			},
			blocks: [
				{
					id: "country",
					uses: "ip.country",
					forEach: "host",
					inputs: (ctx) => ({ ip: ctx.host.ip }),
					mergeInto: "host"
				}
			]
		};

		return engine.run(flow).then(() => {
			const hosts = store.all("host");

			expect(hosts).toHaveLength(1);
			expect(hosts[0].fields.country_code.value).toBe("US");
			expect(hosts[0].fields.country_code.provenance.block).toBe("country");
		});
	});
});
