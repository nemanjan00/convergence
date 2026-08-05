const enrichJs = require("../index");

describe("block.js (script block)", () => {
	it("runs a snippet with stdlib and input, returning fields", () => {
		return enrichJs.handler({
			code: "return { net: ip(input.ip).mask(24) + '/24' };",
			ip: "93.184.216.34"
		}).then((fields) => {
			expect(fields).toEqual({ net: "93.184.216.0/24" });
		});
	});

	it("exposes subnet membership via stdlib", () => {
		return enrichJs.handler({
			code: "return { inRange: ip(input.ip).isInSubnet('10.0.0.0/8') };",
			ip: "10.1.2.3"
		}).then((fields) => {
			expect(fields.inRange).toBe(true);
		});
	});

	it("coerces a non-object return to no fields", () => {
		return enrichJs.handler({ code: "return 42;" }).then((fields) => {
			expect(fields).toEqual({});
		});
	});

	it("rejects when no code is given", () => {
		return enrichJs.handler({ ip: "1.2.3.4" }).then(
			() => {
				throw new Error("expected rejection");
			},
			(error) => {
				expect(error.message).toMatch(/requires an `code`/);
			}
		);
	});

	it("enforces a timeout on runaway scripts", () => {
		return enrichJs.handler({ code: "while (true) {}" }).then(
			() => {
				throw new Error("expected timeout");
			},
			(error) => {
				expect(error.message).toMatch(/timed out|Script execution/i);
			}
		);
	});
});
