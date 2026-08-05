// Cache service. Backed by Redis when REDIS_URL is configured, otherwise an
// in-process Map so blocks cache identically offline (tests, local dev) with no
// server. Named for what it does (cache), not the backend.
//
// Recon facts are stable, so blocks cache aggressively with long TTLs. Batch
// helpers (mget/msetEx) mirror the Redis calls the enrichment blocks make.

const config = require("../../config");

// Lazily construct the backend on first use so merely requiring this module
// never opens a connection (important for offline tests).
const cache = {
	_redis: undefined,
	_memory: {},
	_resolved: false,

	_backend: () => {
		if (cache._resolved) {
			return cache._redis;
		}

		cache._resolved = true;

		const url = config.get("REDIS_URL");

		if (!url) {
			cache._redis = null;
			return null;
		}

		const Redis = require("ioredis");

		// lazyConnect so construction doesn't eagerly dial the server.
		cache._redis = new Redis(url, { lazyConnect: true });

		return cache._redis;
	},

	get: (key) => {
		const redis = cache._backend();

		if (!redis) {
			const value = cache._memory[key];
			return Promise.resolve(value === undefined ? null : value);
		}

		return redis.get(key);
	},

	// value is a string; ttlSeconds optional.
	set: (key, value, ttlSeconds) => {
		const redis = cache._backend();

		if (!redis) {
			cache._memory[key] = value;
			return Promise.resolve("OK");
		}

		if (ttlSeconds) {
			return redis.set(key, value, "EX", ttlSeconds);
		}

		return redis.set(key, value);
	},

	mget: (keys) => {
		if (keys.length === 0) {
			return Promise.resolve([]);
		}

		const redis = cache._backend();

		if (!redis) {
			return Promise.resolve(keys.map((key) => {
				const value = cache._memory[key];
				return value === undefined ? null : value;
			}));
		}

		return redis.mget(keys);
	},

	// Batch write with a shared TTL. entries: [{ key, value }].
	msetEx: (entries, ttlSeconds) => {
		if (entries.length === 0) {
			return Promise.resolve();
		}

		const redis = cache._backend();

		if (!redis) {
			entries.forEach((entry) => {
				cache._memory[entry.key] = entry.value;
			});
			return Promise.resolve();
		}

		const pipeline = redis.pipeline();

		entries.forEach((entry) => {
			if (ttlSeconds) {
				pipeline.set(entry.key, entry.value, "EX", ttlSeconds);
			} else {
				pipeline.set(entry.key, entry.value);
			}
		});

		return pipeline.exec();
	},

	// Test helper: clear the in-memory backend.
	_reset: () => {
		cache._memory = {};
	}
};

module.exports = cache;
