const blocks = require("../index");

// Pure / logic blocks (no network): assert the actual behaviour, not just
// tolerance. These are deterministic so they run fully offline.
describe("logic blocks", () => {
	const map = blocks.allMap();

	describe("url.parse", () => {
		it("splits a URL into parts (host typed to link -> host)", () => {
			return map["url.parse"].handler({ url: "https://api.example.com:8443/v1/x?a=1" })
				.then((fields) => {
					expect(fields.scheme).toBe("https");
					expect(fields.host).toBe("api.example.com");
					expect(fields.port).toBe("8443");
					expect(fields.path).toBe("/v1/x");
					expect(fields.query).toBe("a=1");
				});
		});

		it("is tolerant of garbage", () => {
			return map["url.parse"].handler({ url: "not a url" }).then((fields) => {
				expect(fields).toEqual({});
			});
		});
	});

	describe("email.parse", () => {
		it("splits into local + domain (domain typed to link -> domain)", () => {
			return map["email.parse"].handler({ email: "Abuse@Example.COM" }).then((fields) => {
				expect(fields.local).toBe("abuse");
				expect(fields.domain).toBe("example.com");
			});
		});

		it("rejects a non-address", () => {
			return map["email.parse"].handler({ email: "nope" }).then((fields) => {
				expect(fields).toEqual({});
			});
		});
	});

	describe("hash.digest", () => {
		it("computes md5/sha1/sha256 of a value", () => {
			return map["hash.digest"].handler({ value: "abc" }).then((fields) => {
				expect(fields.md5).toBe("900150983cd24fb0d6963f7d28e17f72");
				expect(fields.sha1).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
				expect(fields.sha256).toBe(
					"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
			});
		});

		it("honours the algos selector", () => {
			return map["hash.digest"].handler({ value: "abc", algos: ["sha256"] }).then((fields) => {
				expect(Object.keys(fields)).toEqual(["sha256"]);
			});
		});
	});

	describe("filter", () => {
		it("array-select: keeps only the matching elements of a field", () => {
			// The user's flow: keep only the TXT records that are SPF.
			return map["filter"].handler({
				subject: { txt: ["v=spf1 include:_spf.google.com ~all", "google-site-verification=xyz"] },
				from: "txt",
				where: { value: { $regex: "^v=spf1" } },
				as: "spf_records"
			}).then((fields) => {
				expect(fields.spf_records).toEqual(["v=spf1 include:_spf.google.com ~all"]);
			});
		});

		it("where + as: tags a subject that matches", () => {
			return map["filter"].handler({
				subject: { open_ports: [80, 443] },
				where: { open_ports: { $in: [443] } },
				as: "is_web"
			}).then((fields) => {
				expect(fields.is_web).toBe(true);
			});
		});

		it("where: no match => {}", () => {
			return map["filter"].handler({
				subject: { open_ports: [22] },
				where: { open_ports: { $in: [443] } },
				as: "is_web"
			}).then((fields) => {
				expect(fields).toEqual({});
			});
		});

		it("rules: first matching rule classifies (switch/router)", () => {
			return map["filter"].handler({
				subject: { cert_issuer: "Let's Encrypt" },
				rules: [
					{ when: { cert_issuer: { $regex: "Let's Encrypt" } }, label: "le" },
					{ when: {}, label: "other" }
				]
			}).then((fields) => {
				expect(fields.class).toBe("le");
			});
		});

		it("no predicate => inert ({})", () => {
			return map["filter"].handler({ subject: { a: 1 } }).then((fields) => {
				expect(fields).toEqual({});
			});
		});
	});
});
