// Source: source.tick — emit a heartbeat entity carrying the current time, so a
// flow can be driven BY time. Paired with the monitor scheduler (bin/monitor.js,
// which re-runs a flow on a cron), each scheduled run gets a fresh `tick` entity
// whose `at` changes every run — a `last-write-wins` field that always advances,
// which is exactly what re-triggers time-sensitive blocks each pass.
//
// Mostly you monitor by re-running an existing flow on a schedule (persistence
// accumulates, the journal diffs); source.tick is for flows whose subject IS the
// clock (poll an endpoint every N minutes, re-check an expiry, etc.).
//
//   params.items: optional seed items merged with the tick (same as source.list).
//   params.label: optional name stamped on the tick.

const tick = {
	source: "source.tick",
	pull: (params) => {
		const now = new Date();

		const beat = {
			id: params && params.label ? params.label : "tick",
			at: now.toISOString(),
			epoch: now.getTime()
		};

		const seed = (params && params.items) || [];

		return Promise.resolve([beat].concat(seed));
	}
};

module.exports = tick;
