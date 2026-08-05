const template = require("../index");

describe("template", () => {
	const ctx = {
		cert: { san: ["a.example.com", "b.example.com"], issuer: { O: "Let's Encrypt" } },
		host: { ip: "1.2.3.4", open_ports: [80, 443] }
	};

	it("resolves dotted and indexed paths", () => {
		expect(template.resolvePath(ctx, "cert.san[0]")).toBe("a.example.com");
		expect(template.resolvePath(ctx, "cert.issuer.O")).toBe("Let's Encrypt");
		expect(template.resolvePath(ctx, "host.ip")).toBe("1.2.3.4");
	});

	it("returns null for a missing path", () => {
		expect(template.resolvePath(ctx, "host.nope.deep")).toBeNull();
	});

	it("passes whole-value placeholders through with type preserved", () => {
		const resolve = template.compileInputs({ ports: "{{ host.open_ports }}" });

		expect(resolve(ctx)).toEqual({ ports: [80, 443] });
	});

	it("interpolates mixed text and placeholders as a string", () => {
		const resolve = template.compileInputs({ url: "https://{{ host.ip }}/x" });

		expect(resolve(ctx)).toEqual({ url: "https://1.2.3.4/x" });
	});

	it("treats no-placeholder strings as constants", () => {
		const resolve = template.compileInputs({ args: "-sV --top-ports 100" });

		expect(resolve(ctx)).toEqual({ args: "-sV --top-ports 100" });
	});

	it("recurses into nested objects and passes scalars through", () => {
		const resolve = template.compileInputs({
			target: "{{ host.ip }}",
			opts: { retries: 3, name: "{{ cert.san[0] }}" }
		});

		expect(resolve(ctx)).toEqual({
			target: "1.2.3.4",
			opts: { retries: 3, name: "a.example.com" }
		});
	});

	it("rejects an invalid path", () => {
		expect(() => {
			return template.assertPath("cert.san; drop table");
		}).toThrow(/invalid template path/);
	});
});
