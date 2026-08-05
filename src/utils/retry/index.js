// Generic retry wrapper for promise-returning functions. Retries up to `times`
// on rejection, surfacing the last error. Keep the wrapped function
// idempotent-safe — retries assume re-invocation is harmless (true for lookups).
//
// Usage: const lookup = retry(cacheable.lookupAsync, 3);

const DEFAULT_TIMES = 3;

const retry = (func, times) => {
	const attempts = (times === undefined) ? DEFAULT_TIMES : times;

	const attempt = (remaining, args) => {
		return Promise.resolve()
			.then(() => {
				return func(...args);
			})
			.catch((error) => {
				if (remaining <= 0) {
					throw error;
				}

				return attempt(remaining - 1, args);
			});
	};

	return (...args) => {
		return attempt(attempts, args);
	};
};

module.exports = retry;
