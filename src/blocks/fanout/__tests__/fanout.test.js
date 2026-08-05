const fanout = require("../index");
const engineFactory = require("../../../engine");
const store = require("../../../services/store");

describe("fanout block", () => {
	it("maps each item to an entity field-set", () => {
		return fanout.handler({ items: ["a.com", "b.com"], as: "name" }).then((out) => {
			expect(out).toEqual([{ name: "a.com" }, { name: "b.com" }]);
		});
	});

	it("returns an empty batch for no items", () => {
		return fanout.handler({}).then((out) => {
			expect(out).toEqual([]);
		});
	});

	it("fans one cert into many host entities through the engine", () => {
		store._reset();
		const engine = engineFactory.create();
		engine.registerBlock("fanout", fanout.handler);

		const flow = {
			name: "fanout-test",
			entities: {
				cert: { key: ["id"], merge: "last-write-wins-with-provenance" },
				host: { key: ["name"], merge: "last-write-wins-with-provenance" }
			},
			source: {
				id: "seed",
				emits: "cert",
				pull: () => {
					return Promise.resolve([{ id: 1, san: ["a.com", "b.com", "c.com"] }]);
				}
			},
			blocks: [
				{
					id: "explode",
					uses: "fanout",
					forEach: "cert",
					inputs: (ctx) => ({ items: ctx.cert.san, as: "name" }),
					mergeInto: "host"
				}
			]
		};

		return engine.run(flow).then(() => {
			const hosts = store.all("host").map((host) => {
				return host.fields.name.value;
			}).sort();

			expect(hosts).toEqual(["a.com", "b.com", "c.com"]);
			expect(store.all("host")[0].fields.name.provenance.block).toBe("explode");
		});
	});
});
