const request = require("supertest");
const createApp = require("../index").createApp;
const playbooks = require("../../services/playbooks");

const VALID_YAML = [
	"apiVersion: v0", "kind: Flow", "metadata:", "  name: t",
	"entities:", "  host: { key: [name] }",
	"sources:", "  - id: seed", "    block: source.list", "    emits: host",
	"blocks:", "  - id: r", "    uses: dns.a", "    for_each: host",
	"    merge_into: host", "    inputs: { name: \"{{ host.name }}\" }"
].join("\n");

// Offline API surface (no flow-run routes, which need the network).
describe("HTTP API", () => {
	let app;

	beforeEach(() => {
		playbooks._reset();
		app = createApp();
	});

	it("GET /api/health", () => {
		return request(app).get("/api/health").expect(200).then((res) => {
			expect(res.body.ok).toBe(true);
			expect(res.body.blocks).toBeGreaterThan(0);
			expect(res.body.persist).toBe("per-mutation");
		});
	});

	it("mutations call persist() BEFORE responding (durable on every write)", () => {
		let calls = 0;
		const spied = createApp({ persist: () => { calls = calls + 1; return Promise.resolve(); } });

		return request(spied).post("/api/playbooks").send({ name: "p", yaml: VALID_YAML }).expect(201)
			.then((res) => {
				expect(calls).toBe(1); // create persisted
				return request(spied).post("/api/playbooks/" + res.body.id + "/state").send({ state: "active" }).expect(200);
			})
			.then(() => {
				expect(calls).toBe(2); // activate persisted -> state survives a restart
			});
	});

	it("GET /api/blocks lists the library", () => {
		return request(app).get("/api/blocks").expect(200).then((res) => {
			expect(res.body.blocks.length).toBeGreaterThan(0);
			expect(res.body.sources.length).toBeGreaterThan(0);
		});
	});

	it("POST /api/flows/validate returns validity", () => {
		return request(app).post("/api/flows/validate").send({ yaml: "garbage" }).expect(200).then((res) => {
			expect(res.body.valid).toBe(false);
		});
	});

	it("playbook lifecycle over HTTP: create -> activate -> list -> export", () => {
		return request(app).post("/api/playbooks").send({ name: "recon", yaml: VALID_YAML }).expect(201)
			.then((res) => {
				const id = res.body.id;
				expect(res.body.valid).toBe(true);

				return request(app).post("/api/playbooks/" + id + "/state").send({ state: "active" }).expect(200)
					.then((activated) => {
						expect(activated.body.state).toBe("active");

						return request(app).get("/api/playbooks").expect(200);
					})
					.then((list) => {
						expect(list.body.playbooks.map((p) => p.id)).toContain(id);

						return request(app).get("/api/playbooks/" + id + "/export").expect(200);
					})
					.then((exported) => {
						expect(exported.body).toMatchObject({ convergencePlaybook: 1, name: "recon" });
					});
			});
	});

	it("refuses to activate an invalid playbook (400)", () => {
		return request(app).post("/api/playbooks").send({ name: "wip", yaml: "garbage" }).expect(201)
			.then((res) => {
				return request(app).post("/api/playbooks/" + res.body.id + "/state")
					.send({ state: "active" }).expect(400);
			});
	});

	it("POST /api/webhook enqueues pushed items", () => {
		return request(app).post("/api/webhook").send({ items: [{ address: "1.1.1.1" }, { address: "8.8.8.8" }] })
			.expect(200).then((res) => {
				expect(res.body.enqueued).toBe(2);
			});
	});

	it("unknown /api path -> JSON 404 (never HTML)", () => {
		return request(app).get("/api/nope").expect(404).then((res) => {
			expect(res.body.error).toMatch(/not found/);
		});
	});

	it("malformed JSON body -> JSON 400 (not an HTML stack page)", () => {
		return request(app).post("/api/playbooks")
			.set("content-type", "application/json").send("{bad json")
			.expect(400).then((res) => {
				expect(res.body).toHaveProperty("error");
			});
	});

	it("GET /api/snapshot returns a render payload", () => {
		return request(app).get("/api/snapshot").expect(200).then((res) => {
			expect(res.body).toHaveProperty("entities");
			expect(res.body).toHaveProperty("executions");
			expect(res.body).toHaveProperty("playbooks");
			expect(res.body).toHaveProperty("samples");
		});
	});

	it("GET /api/samples lists the bundled example flows as importable artifacts", () => {
		return request(app).get("/api/samples").expect(200).then((res) => {
			expect(res.body.samples.length).toBeGreaterThan(0);
			expect(res.body.samples[0]).toHaveProperty("name");
			expect(res.body.samples[0]).toHaveProperty("yaml");
		});
	});
});
