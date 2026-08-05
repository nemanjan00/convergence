const map = require("../index");

describe("map block (JSON -> typed fields)", () => {
	it("picks dotted / indexed paths out of a JSON object", () => {
		return map.handler({
			from: {
				country: "AU",
				org: "Cloudflare",
				entities: [{ email: "abuse@cf.com" }]
			},
			pick: {
				country: "country",
				owner: "org",
				abuse: "entities[0].email",
				missing: "does.not.exist"
			}
		}).then((fields) => {
			expect(fields).toEqual({ country: "AU", owner: "Cloudflare", abuse: "abuse@cf.com" });
		});
	});

	it("returns no fields for empty input", () => {
		return map.handler({}).then((fields) => {
			expect(fields).toEqual({});
		});
	});
});
