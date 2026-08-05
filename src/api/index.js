// The served HTTP API — the single stateful process that owns the store,
// execution journal, and playbook registry, exposes them over REST, and serves
// the frontend. Both surfaces talk to THIS: the qrp UI (fetch /api/*) and the
// AI (the MCP server in bin/mcp.mjs is an HTTP client of these same routes). The
// engine/registry/services are shared in-process; Mongo persistence (wired in
// src/index.js) makes state durable across restarts.
//
// createApp() returns an express app WITHOUT listening, so it's testable with
// supertest offline (only the run/flow routes touch the network).

const express = require("express");
const path = require("path");
const mcp = require("../mcp");
const playbooks = require("../services/playbooks");
const journal = require("../services/journal");
const store = require("../services/store");
const loader = require("../loader");
const sources = require("../sources");
const samples = require("../samples");

// Flatten an entity to the { type, key, version, fields:{name:{value,block,at}} }
// shape the frontend renders (same as bin/export.js).
const serializeEntity = (entity) => {
	const fields = {};

	Object.keys(entity.fields).forEach((name) => {
		fields[name] = {
			value: entity.fields[name].value,
			block: entity.fields[name].provenance.block,
			at: entity.fields[name].provenance.at
		};
	});

	return { type: entity._type, key: entity._identity, version: entity._version, fields: fields };
};

// A full render snapshot for the frontend: the current entities/edges/journal
// plus the flow spec of the first active playbook (drives the builder/graph).
const snapshot = () => {
	const active = playbooks.active()[0] || null;
	const yaml = active ? active.yaml : "";
	let spec = { entities: {}, sources: [], blocks: [] };

	if (yaml) {
		try {
			spec = loader.parse(yaml);
		} catch {
			// leave the empty spec on a bad/incomplete playbook
		}
	}

	const entities = {};

	Object.keys(store._collections).forEach((type) => {
		entities[type] = store.all(type).map(serializeEntity);
	});

	return {
		flow: active ? active.name : "convergence",
		yaml: yaml,
		spec: spec,
		entities: entities,
		edges: store.edges(),
		executions: journal.all(),
		playbooks: playbooks.all(),
		samples: samples.all()
	};
};

const createApp = () => {
	const app = express();

	app.use(express.json({ limit: "4mb" }));
	// Allow the browser UI to call the API from anywhere it's served.
	app.use((req, res, next) => {
		res.set("access-control-allow-origin", "*");
		res.set("access-control-allow-headers", "content-type");
		res.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
		if (req.method === "OPTIONS") { return res.status(204).end(); }
		return next();
	});

	// --- meta / data plane ---
	app.get("/api/health", (req, res) => {
		res.json({ ok: true, blocks: mcp.listBlocks().blocks.length });
	});

	app.get("/api/blocks", (req, res) => { res.json(mcp.listBlocks()); });

	app.get("/api/snapshot", (req, res) => { res.json(snapshot()); });

	app.get("/api/samples", (req, res) => { res.json({ samples: samples.all() }); });

	app.post("/api/flows/validate", (req, res) => {
		res.json(mcp.validateFlow(req.body && req.body.yaml));
	});

	app.post("/api/flows/run", (req, res) => {
		mcp.runFlow(req.body && req.body.yaml)
			.then((result) => { res.json(result); })
			.catch((error) => { res.status(400).json({ error: error.message }); });
	});

	app.post("/api/entities/query", (req, res) => { res.json(mcp.queryEntities(req.body || {})); });

	app.get("/api/executions", (req, res) => {
		res.json({ executions: req.query.failed ? journal.failed() : journal.all() });
	});

	// --- inbound webhook (push side of ingest) ---
	app.post("/api/webhook", (req, res) => {
		const webhook = sources.allMap()["source.webhook"];
		const body = req.body || {};
		const enqueued = webhook.push(body.items !== undefined ? body.items : body);

		res.json({ enqueued: enqueued });
	});

	// --- playbooks (control plane) ---
	app.get("/api/playbooks", (req, res) => { res.json(mcp.listPlaybooks()); });

	app.post("/api/playbooks", (req, res) => { res.status(201).json(playbooks.create(req.body || {})); });

	app.post("/api/playbooks/import", (req, res) => { res.status(201).json(playbooks.import(req.body || {})); });

	app.get("/api/playbooks/:id", (req, res) => {
		const book = playbooks.get(req.params.id);

		if (!book) { return res.status(404).json({ error: "not found" }); }

		return res.json(book);
	});

	app.get("/api/playbooks/:id/export", (req, res) => {
		const artifact = playbooks.export(req.params.id);

		if (!artifact) { return res.status(404).json({ error: "not found" }); }

		return res.json(artifact);
	});

	app.put("/api/playbooks/:id", (req, res) => {
		const book = playbooks.update(req.params.id, req.body || {});

		if (!book) { return res.status(404).json({ error: "not found" }); }

		return res.json(book);
	});

	app.post("/api/playbooks/:id/state", (req, res) => {
		try {
			res.json(playbooks.setState(req.params.id, req.body && req.body.state));
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	app.post("/api/playbooks/:id/run", (req, res) => {
		const book = playbooks.get(req.params.id);

		if (!book) { return res.status(404).json({ error: "not found" }); }

		return mcp.runFlow(book.yaml)
			.then((result) => {
				playbooks.recordRun(book.id, result.entities
					? Object.keys(result.entities).reduce((counts, type) => {
						counts[type] = result.entities[type].length;
						return counts;
					}, {})
					: null);
				res.json(result);
			})
			.catch((error) => { res.status(400).json({ error: error.message }); });
	});

	app.delete("/api/playbooks/:id", (req, res) => {
		res.json({ removed: playbooks.remove(req.params.id) });
	});

	// --- static frontend (the esbuild bundle) ---
	const dist = path.join(__dirname, "../../frontend/dist");

	// `/` serves the LIVE page (no baked data; the bundle fetches /api/snapshot).
	// Falls back to a clear message if the frontend hasn't been built yet.
	app.get("/", (req, res) => {
		res.sendFile(path.join(dist, "live.html"), (error) => {
			if (error) {
				res.status(200).type("html").send(
					"<h1>convergence</h1><p>API is up. Build the UI with " +
					"<code>yarn frontend:build</code> to serve it here.</p>");
			}
		});
	});

	// Unknown /api/* path -> JSON 404 (never fall through to static HTML).
	app.use("/api", (req, res) => {
		res.status(404).json({ error: "not found: " + req.method + " " + req.originalUrl });
	});

	app.use(express.static(dist));

	// JSON error handler — bad body / thrown route errors come back as JSON, not
	// an HTML stack page. (4-arg signature marks it as express error middleware.)
	// eslint-disable-next-line no-unused-vars
	app.use((error, req, res, next) => {
		const status = error.status || error.statusCode || 400;

		res.status(status).json({ error: error.message || "error" });
	});

	return app;
};

module.exports = { createApp: createApp, snapshot: snapshot };
