const blocks = require("../index");
const runtimeFactory = require("../../runtime");
const store = require("../../services/store");

describe("built-in blocks", () => {
	beforeEach(() => {
		store._reset();
	});

	it("exposes a uses -> block map", () => {
		expect(blocks.allMap()["enrich.country"]).toBeDefined();
	});

	it("enrich.country attaches country_code from an IP, offline", () => {
		return blocks.allMap()["enrich.country"].handler({ ip: "93.184.216.34" })
			.then((fields) => {
				expect(fields.country_code).toBe("US");
			});
	});

	it("enrich.country returns no fields for an unknown IP", () => {
		return blocks.allMap()["enrich.country"].handler({ ip: "1.2.3.4" })
			.then((fields) => {
				expect(fields).toEqual({});
			});
	});

	it("registers into a runtime and runs in a flow", () => {
		const runtime = runtimeFactory.create();
		blocks.register(runtime);

		const flow = {
			name: "country-test",
			entities: { host: { key: ["ip"], merge: "last-write-wins-with-provenance" } },
			source: {
				emits: "seed",
				pull: () => {
					return Promise.resolve([{ ip: "93.184.216.34" }]);
				}
			},
			blocks: [
				{
					id: "country",
					uses: "enrich.country",
					inputs: (ctx) => ({ ip: ctx.seed.ip }),
					mergeInto: "host"
				}
			]
		};

		return runtime.run(flow).then(() => {
			const hosts = store.all("host");

			expect(hosts).toHaveLength(1);
			expect(hosts[0].fields.country_code.value).toBe("US");
			expect(hosts[0].fields.country_code.provenance.block).toBe("country");
		});
	});
});
