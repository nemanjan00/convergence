const playbooks = require("../index");

// A minimal valid flow YAML (matches the loader contract).
const VALID_YAML = [
	"apiVersion: v0",
	"kind: Flow",
	"metadata:",
	"  name: t",
	"entities:",
	"  host: { key: [name] }",
	"sources:",
	"  - id: seed",
	"    block: source.list",
	"    emits: host",
	"blocks:",
	"  - id: resolve",
	"    uses: dns.a",
	"    for_each: host",
	"    merge_into: host",
	"    inputs: { name: \"{{ host.name }}\" }"
].join("\n");

describe("playbooks registry", () => {
	beforeEach(() => {
		playbooks._reset();
	});

	it("creates a draft and tracks validity", () => {
		const book = playbooks.create({ name: "recon", yaml: VALID_YAML });

		expect(book.state).toBe("draft");
		expect(book.valid).toBe(true);
		expect(book.id).toBeDefined();
	});

	it("marks an invalid draft invalid but still stores it", () => {
		const book = playbooks.create({ name: "wip", yaml: "not: valid: flow" });

		expect(book.valid).toBe(false);
		expect(book.errors.length).toBeGreaterThan(0);
		expect(playbooks.get(book.id)).toBeTruthy();
	});

	it("lifecycle: draft -> active -> paused, and active listing", () => {
		const book = playbooks.create({ name: "recon", yaml: VALID_YAML });

		playbooks.setState(book.id, "active");
		expect(playbooks.get(book.id).state).toBe("active");
		expect(playbooks.active().map((b) => b.id)).toEqual([book.id]);

		playbooks.setState(book.id, "paused");
		expect(playbooks.active()).toHaveLength(0);
	});

	it("refuses to activate an invalid playbook", () => {
		const book = playbooks.create({ name: "wip", yaml: "garbage" });

		expect(() => { playbooks.setState(book.id, "active"); }).toThrow(/cannot activate/);
	});

	it("re-validates on yaml update", () => {
		const book = playbooks.create({ name: "wip", yaml: "garbage" });
		expect(book.valid).toBe(false);

		playbooks.update(book.id, { yaml: VALID_YAML });
		expect(playbooks.get(book.id).valid).toBe(true);
	});

	it("removes a playbook", () => {
		const book = playbooks.create({ name: "x", yaml: VALID_YAML });

		expect(playbooks.remove(book.id)).toBe(true);
		expect(playbooks.get(book.id)).toBeNull();
	});

	it("export -> import round-trips a portable artifact (no id/state carried)", () => {
		const original = playbooks.create({ name: "recon", yaml: VALID_YAML, schedule: "*/30 * * * *" });
		playbooks.setState(original.id, "active");

		const artifact = playbooks.export(original.id);
		expect(artifact).toEqual({
			convergencePlaybook: 1, name: "recon", schedule: "*/30 * * * *", yaml: VALID_YAML
		});

		const imported = playbooks.import(artifact);
		expect(imported.id).not.toBe(original.id); // a fresh instance
		expect(imported.state).toBe("draft");      // never carries runtime state
		expect(imported.name).toBe("recon");
		expect(imported.valid).toBe(true);
	});

	it("import accepts a bare YAML string, naming from metadata", () => {
		const imported = playbooks.import(VALID_YAML);

		expect(imported.name).toBe("t"); // metadata.name from the flow
		expect(imported.valid).toBe(true);
	});
});
