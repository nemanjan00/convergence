const journal = require("../index");

const entry = (block, type, key, status) => {
	return { block: block, uses: block, entity: { type: type, key: key }, status: status, changed: status === "ok" };
};

describe("execution journal", () => {
	beforeEach(() => {
		journal._reset();
	});

	it("records executions and lists them in order", () => {
		journal.record(entry("resolve", "host", "a", "ok"));
		journal.record(entry("scan", "host", "a", "skipped"));

		const all = journal.all();

		expect(all).toHaveLength(2);
		expect(all[0].block).toBe("resolve");
		expect(all[0].id).toBeDefined();
		expect(all[0].at).toBeDefined();
	});

	it("filters by block and by entity", () => {
		journal.record(entry("resolve", "host", "a", "ok"));
		journal.record(entry("resolve", "host", "b", "ok"));
		journal.record(entry("scan", "host", "a", "ok"));

		expect(journal.forBlock("resolve")).toHaveLength(2);
		expect(journal.forEntity("host", "a")).toHaveLength(2);
	});

	it("failed() returns only targets whose FINAL state is an error (not failed-then-recovered)", () => {
		// host a: failed, then retried OK -> NOT failed anymore.
		journal.record(entry("resolve", "host", "a", "error"));
		journal.record(entry("resolve", "host", "a", "ok"));

		// host b: still failing -> in the retry queue.
		journal.record(entry("resolve", "host", "b", "error"));

		// host c: a different block still failing.
		journal.record(entry("scan", "host", "c", "error"));

		const failed = journal.failed();
		const keys = failed.map((e) => { return e.block + ":" + e.entity.key; }).sort();

		expect(keys).toEqual(["resolve:b", "scan:c"]);
	});

	it("latestByTarget collapses a target's history to its current state", () => {
		journal.record(entry("resolve", "host", "a", "error"));
		journal.record(entry("resolve", "host", "a", "ok"));

		const latest = journal.latestByTarget();

		expect(latest).toHaveLength(1);
		expect(latest[0].status).toBe("ok");
	});
});
