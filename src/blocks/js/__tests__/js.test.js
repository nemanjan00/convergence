const jsBlock = require("../index");

describe("js (script block)", () => {
	it("runs a snippet with stdlib and input, returning fields", () => {
		return jsBlock.handler({
			code: "return { net: ip(input.ip).mask(24) + '/24' };",
			ip: "93.184.216.34"
		}).then((fields) => {
			expect(fields).toEqual({ net: "93.184.216.0/24" });
		});
	});

	it("exposes subnet membership via stdlib", () => {
		return jsBlock.handler({
			code: "return { inRange: ip(input.ip).isInSubnet('10.0.0.0/8') };",
			ip: "10.1.2.3"
		}).then((fields) => {
			expect(fields.inRange).toBe(true);
		});
	});

	it("coerces a non-object return to no fields", () => {
		return jsBlock.handler({ code: "return 42;" }).then((fields) => {
			expect(fields).toEqual({});
		});
	});

	it("is tolerant when no code is given (resolves {} — never rejects into the engine)", () => {
		return jsBlock.handler({ ip: "1.2.3.4" }).then((fields) => {
			expect(fields).toEqual({});
		});
	});

	it("enforces a timeout on runaway scripts", () => {
		return jsBlock.handler({ code: "while (true) {}" }).then(
			() => {
				throw new Error("expected timeout");
			},
			(error) => {
				expect(error.message).toMatch(/timed out|Script execution/i);
			}
		);
	});
});
