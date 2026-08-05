const runtimeFactory = require("../index");
const store = require("../../services/store");

// A block handler is just input => Promise<fields>.
const constantBlock = (fields) => {
	return () => {
		return Promise.resolve(fields);
	};
};

const buildFlow = () => {
	return {
		name: "test",
		entities: {
			host: { key: ["ip"], merge: "last-write-wins-with-provenance" }
		},
		source: {
			emits: "cert",
			pull: () => {
				return Promise.resolve([{ san: ["a.example.com"] }]);
			}
		},
		blocks: [
			{
				id: "resolve",
				uses: "enrich.dns-a",
				inputs: (ctx) => ({ name: ctx.cert.san[0] }),
				mergeInto: "host"
			},
			{
				id: "scan",
				uses: "enrich.nmap",
				when: { "host.ip": { $ne: null } },
				inputs: (ctx) => ({ target: ctx.host.ip }),
				mergeInto: "host"
			}
		]
	};
};

describe("runtime", () => {
	beforeEach(() => {
		store._reset();
	});

	it("fans multiple blocks into one entity with provenance", () => {
		const runtime = runtimeFactory.create();

		runtime.registerBlock("enrich.dns-a", constantBlock({ ip: "1.2.3.4" }));
		runtime.registerBlock("enrich.nmap", constantBlock({ open_ports: [80, 443] }));

		return runtime.run(buildFlow()).then(() => {
			const hosts = store.all("host");

			expect(hosts).toHaveLength(1);
			expect(hosts[0].fields.ip.value).toBe("1.2.3.4");
			expect(hosts[0].fields.open_ports.value).toEqual([80, 443]);
			expect(hosts[0].fields.ip.provenance.block).toBe("resolve");
			expect(hosts[0].fields.open_ports.provenance.block).toBe("scan");
		});
	});

	it("skips a block whose sift `when` guard does not match", () => {
		const runtime = runtimeFactory.create();

		// dns-a produces no ip, so scan's guard { host.ip: {$ne:null} } fails.
		runtime.registerBlock("enrich.dns-a", constantBlock({ note: "no-ip" }));
		runtime.registerBlock("enrich.nmap", constantBlock({ open_ports: [80] }));

		return runtime.run(buildFlow()).then(() => {
			const hosts = store.all("host");

			// No ip was ever produced, so the entity keyed on ip has no scan data.
			const scanned = hosts.some((host) => {
				return host.fields.open_ports !== undefined;
			});

			expect(scanned).toBe(false);
		});
	});

	it("rejects an unknown block", () => {
		const runtime = runtimeFactory.create();
		const flow = buildFlow();

		return runtime.run(flow).then(
			() => {
				throw new Error("expected rejection");
			},
			(error) => {
				expect(error.message).toMatch(/unknown block/);
			}
		);
	});
});
