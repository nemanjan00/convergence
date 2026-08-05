// Central config. Reads from environment with sane defaults so the demo runs
// with zero setup. Access via config.get("KEY").

const DEFAULTS = {
	MONGO_URL: "mongodb://localhost:27017",
	MONGO_DB: "recon",
	// Default fan-out concurrency for blocks that do not declare their own.
	DEFAULT_MAX_CONCURRENT: "10",
	// Bounded-queue capacity; the backpressure knob for the whole runtime.
	QUEUE_CAPACITY: "1000"
};

const config = {
	get: (key) => {
		if (process.env[key] !== undefined) {
			return process.env[key];
		}

		return DEFAULTS[key];
	},

	// Numeric convenience getter — config values are strings by nature.
	getNumber: (key) => {
		return Number(config.get(key));
	}
};

module.exports = config;
