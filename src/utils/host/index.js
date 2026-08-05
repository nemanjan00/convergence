// Block target-input normalization — one place for "figure out what target the
// block was handed" (a host/domain, an IP, or a URL) so blocks accept the same
// input keys uniformly instead of each guessing. Pure (no deps),
// frontend-shippable.

// First defined value among the given input keys, or undefined.
const pick = (input, keys) => {
	const key = keys.find((candidate) => { return input[candidate] !== undefined; });

	return key === undefined ? undefined : input[key];
};

const host = {
	/**
	 * Strip a leading wildcard label and surrounding whitespace. Case is
	 * preserved (DNS is case-insensitive; callers lowercase explicitly if needed).
	 * @param {*} name - raw value (coerced to string; null/undefined -> "")
	 * @returns {string} e.g. "*.example.com" -> "example.com"
	 */
	clean: (name) => {
		return String(name === undefined || name === null ? "" : name).replace(/^\*\./, "").trim();
	},

	/**
	 * The host/domain a block should operate on, from whichever common key is
	 * present (domain > name > host > target), cleaned. "" if none (callers
	 * treat "" as "no input" and resolve to {}).
	 * @param {object} input - the block's resolved input
	 * @returns {string}
	 */
	from: (input) => {
		return host.clean(pick(input, ["domain", "name", "host", "target"]));
	},

	/**
	 * The IP address a block should operate on, from `ip` or `address`, trimmed.
	 * @param {object} input - the block's resolved input
	 * @returns {string} "" if neither key is present
	 */
	ip: (input) => {
		const raw = pick(input, ["ip", "address"]);

		return String(raw === undefined || raw === null ? "" : raw).trim();
	},

	/**
	 * The base URL a block should operate on (from `url`), trailing slash removed
	 * so callers can append paths cleanly.
	 * @param {object} input - the block's resolved input
	 * @returns {string} "" if no url
	 */
	url: (input) => {
		return String(input.url === undefined || input.url === null ? "" : input.url).trim().replace(/\/$/, "");
	}
};

module.exports = host;
