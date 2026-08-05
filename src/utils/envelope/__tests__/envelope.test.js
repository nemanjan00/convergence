const envelope = require("../index");

describe("envelope", () => {
	const work = envelope.makeWorkItem({
		flow: "ct-recon",
		run: "run-1",
		block: "scan",
		item_id: "item-1",
		trace: ["ct", "resolve"],
		input: { target: "93.184.216.34" }
	});

	it("makes a work item and fills an id when absent", () => {
		const auto = envelope.makeWorkItem({ flow: "f", run: "r", block: "b" });

		expect(auto.item_id).toEqual(expect.any(String));
		expect(auto.trace).toEqual([]);
	});

	it("accepts a valid work item", () => {
		expect(envelope.assertWorkItem(work)).toBe(work);
	});

	it("rejects a work item missing required keys", () => {
		expect(() => {
			return envelope.assertWorkItem({ flow: "f" });
		}).toThrow(/missing/);
	});

	it("stamps provenance onto a result", () => {
		const result = envelope.makeResult(work, { open_ports: [80, 443] }, {
			at: "2026-08-05T12:00:00Z"
		});

		expect(result.ok).toBe(true);
		expect(result.fields.open_ports).toEqual([80, 443]);
		expect(result.provenance.block).toBe("scan");
		expect(result.provenance.source_item).toBe("item-1");
		expect(result.provenance.at).toBe("2026-08-05T12:00:00Z");
	});

	it("wraps an error without losing the message", () => {
		const result = envelope.makeError(work, new Error("nmap timed out"));

		expect(result.ok).toBe(false);
		expect(result.error.message).toBe("nmap timed out");
	});
});
