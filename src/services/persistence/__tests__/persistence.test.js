const MongoMemoryServer = require("mongodb-memory-server").MongoMemoryServer;
const persistenceFactory = require("../index");
const store = require("../../store");

// Real Mongo persistence, verified against an ephemeral mongod (no external
// server needed). Booting mongod is slow, so allow generous time.
jest.setTimeout(60000);

const provenance = (block) => {
	return { block: block, source_item: null, at: "2026-08-05T00:00:00Z", raw_ref: null };
};

describe("persistence (mongo)", () => {
	let mongod;
	let persistence;

	beforeAll(() => {
		return MongoMemoryServer.create().then((server) => {
			mongod = server;
			persistence = persistenceFactory(server.getUri(), "test");
		});
	});

	afterAll(() => {
		return persistence.close().then(() => {
			return mongod.stop();
		});
	});

	it("saves entities + edges and loads them into a fresh store", () => {
		store._reset();
		store.define("host", { key: ["name"] });
		store.upsert("host", { name: "a.com", ip: "1.2.3.4" }, provenance("resolve"));
		store.addEdge({
			from: { type: "cert", key: "id=1" }, rel: "has_san",
			to: { type: "host", key: "name=\"a.com\"" }, via: "fanout", at: "t"
		});

		return persistence.save(store, ["host"]).then(() => {
			store._reset(); // simulate a new process
			return persistence.load(store, { host: { key: ["name"] } });
		}).then(() => {
			const hosts = store.all("host");

			expect(hosts).toHaveLength(1);
			expect(hosts[0].fields.ip.value).toBe("1.2.3.4");
			expect(hosts[0].fields.ip.provenance.block).toBe("resolve");
			expect(store.edges()).toHaveLength(1);
			expect(store.edges()[0].rel).toBe("has_san");
		});
	});

	it("accumulates across runs (hydrate -> enrich -> save)", () => {
		// The real run.js pattern: hydrate prior state, enrich, save.
		store._reset();

		return persistence.load(store, { host: { key: ["name"] } }).then(() => {
			// a.com came back from the previous test with its ip.
			store.upsert("host", { name: "a.com", title: "hi" }, provenance("http.title"));
			store.upsert("host", { name: "b.com", ip: "9.9.9.9" }, provenance("resolve"));

			return persistence.save(store, ["host"]);
		}).then(() => {
			store._reset();
			return persistence.load(store, { host: { key: ["name"] } });
		}).then(() => {
			const map = store.allMap("host");

			// a.com: ip from run 1 + title from run 2; b.com brand new.
			expect(map["name=\"a.com\""].fields.ip.value).toBe("1.2.3.4");
			expect(map["name=\"a.com\""].fields.title.value).toBe("hi");
			expect(map["name=\"b.com\""].fields.ip.value).toBe("9.9.9.9");
		});
	});
});
