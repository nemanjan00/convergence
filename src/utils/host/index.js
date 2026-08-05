// Hostname/domain input normalization — one place for the "clean the name a
// block was handed" logic that the DNS / CT / passive-DNS blocks all repeat.
// Pure (no deps), frontend-shippable.

const host = {
	// Strip a leading wildcard label ("*.example.com" -> "example.com") and
	// surrounding whitespace. Case is preserved (DNS is case-insensitive but
	// callers that want lowercasing do it explicitly).
	clean: (name) => {
		return String(name === undefined || name === null ? "" : name).replace(/^\*\./, "").trim();
	},

	// The host/domain a block should operate on, taken from whichever of the
	// common input keys is present, cleaned. Returns "" if none — callers treat
	// "" as "no input" and resolve to {}.
	from: (input) => {
		const raw = input.domain !== undefined ? input.domain
			: (input.name !== undefined ? input.name
				: (input.host !== undefined ? input.host : input.target));

		return host.clean(raw);
	}
};

module.exports = host;
