// Source: source.webhook — the INBOUND half of the webhook pair, and the PUSH
// side of the ingest standard (source.list is the pull side). External systems
// POST entities in; a pull() drains whatever has arrived since the last sweep.
//
// The transport (an HTTP endpoint) belongs to the served web app, which isn't
// wired yet — so this module owns the QUEUE and the ingest contract, and the web
// layer will just call source.webhook.push(items) from its route handler. That
// keeps idempotency-by-id + provenance identical to the pull side: pushed items
// are plain entity objects, deduped/merged by the store on their key.
//
//   params.items: optional seed items (same as source.list) drained on first pull.
//
// TODO: wire the HTTP endpoint in src/index.js (served app) to call push().

const QUEUE = [];

const webhook = {
	source: "source.webhook",

	// Called by the (future) HTTP route when a POST arrives. Accepts one item or
	// an array; returns how many were enqueued.
	push: (items) => {
		const batch = Array.isArray(items) ? items : [items];
		const valid = batch.filter((item) => { return item && typeof item === "object"; });

		valid.forEach((item) => { QUEUE.push(item); });

		return valid.length;
	},

	// Drain everything queued since the last sweep (plus any seed items on the
	// first call). The engine re-pulls each convergence sweep, so late arrivals
	// are picked up on the next pass.
	pull: (params) => {
		const seed = (params && params.items) || [];
		const drained = QUEUE.splice(0, QUEUE.length);

		return Promise.resolve(seed.concat(drained));
	}
};

module.exports = webhook;
