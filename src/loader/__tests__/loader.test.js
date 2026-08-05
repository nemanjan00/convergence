const fs = require("fs");
const path = require("path");
const loader = require("../index");

const exampleYaml = fs.readFileSync(
	path.join(__dirname, "../../../examples/flows/ct-recon.yaml")
).toString("utf8");

describe("loader", () => {
	it("validates the canonical example with no errors", () => {
		const spec = loader.parse(exampleYaml);

		expect(loader.validate(spec)).toEqual([]);
	});

	it("compiles the example into a runtime flow with resolvers", () => {
		const flow = loader.load(exampleYaml, {
			sourcePull: () => {
				return Promise.resolve([]);
			}
		});

		expect(flow.name).toBe("ct-recon");
		expect(flow.entities.host.key).toEqual(["name"]);
		expect(flow.source.emits).toBe("cert");

		// fanout explodes cert.san into host names.
		const fanoutBlock = flow.blocks.find((block) => {
			return block.id === "fanout";
		});
		expect(fanoutBlock.inputs({ cert: { san: ["a.example.com", "b.example.com"] } }))
			.toEqual({ items: ["a.example.com", "b.example.com"], as: "name" });

		// resolve reads the host's own name (convergence-native).
		const resolveBlock = flow.blocks.find((block) => {
			return block.id === "resolve";
		});
		expect(resolveBlock.inputs({ host: { name: "a.example.com" } }))
			.toEqual({ name: "a.example.com" });
	});

	it("flags unknown apiVersion, missing entity, dangling for_each", () => {
		const errors = loader.validate({
			apiVersion: "v9",
			metadata: { name: "x" },
			entities: { host: { key: ["ip"] } },
			sources: [{ id: "s", block: "b", emits: "cert" }],
			blocks: [{ id: "b1", uses: "u", for_each: "ghost", merge_into: "nope" }]
		});

		expect(errors).toEqual(expect.arrayContaining([
			expect.stringMatching(/unsupported apiVersion/),
			expect.stringMatching(/merge_into 'nope' is not a declared entity/),
			expect.stringMatching(/for_each 'ghost' is never produced/)
		]));
	});

	it("detects a cycle", () => {
		const errors = loader.validate({
			apiVersion: "v0",
			metadata: { name: "x" },
			entities: { a: { key: ["k"] }, b: { key: ["k"] } },
			sources: [{ id: "s", block: "src", emits: "seed" }],
			blocks: [
				{ id: "ba", uses: "u", for_each: "b", merge_into: "a", inputs: {} },
				{ id: "bb", uses: "u", for_each: "a", merge_into: "b", inputs: {} }
			]
		});

		expect(errors).toEqual(expect.arrayContaining([
			expect.stringMatching(/cycle/)
		]));
	});

	it("rejects a field that links to an undeclared entity", () => {
		const errors = loader.validate({
			apiVersion: "v0",
			metadata: { name: "x" },
			entities: { host: { key: ["name"], fields: { ip: { links: "ip" } } } },
			sources: [{ id: "s", block: "b", emits: "host" }],
			blocks: []
		});

		expect(errors).toEqual(expect.arrayContaining([
			expect.stringMatching(/links to undeclared entity 'ip'/)
		]));
	});

	it("rejects a duplicate id", () => {
		const errors = loader.validate({
			apiVersion: "v0",
			metadata: { name: "x" },
			entities: { host: { key: ["ip"] } },
			sources: [{ id: "dup", block: "b", emits: "host" }],
			blocks: [{ id: "dup", uses: "u", for_each: "host", merge_into: "host", inputs: {} }]
		});

		expect(errors).toEqual(expect.arrayContaining([
			expect.stringMatching(/duplicate id: dup/)
		]));
	});
});
