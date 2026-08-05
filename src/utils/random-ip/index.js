// Egress-address rotation POLICY: pick one of a set of owned ranges and return
// a random address inside it, so outbound recon spreads across an owned prefix.
// The address math lives in utils/ip (ip(cidr).random()); this module is only
// the range-selection policy on top of it.
//
// Pass ranges (CIDR strings, mixed v4/v6 allowed). Defaults to a placeholder
// IPv6 set. TODO: source owned ranges from config, not code.

const ip = require("../ip");

const DEFAULT_RANGES = [
	"2a0d:f407:1006::/48",
	"2a0d:f407:1017::/48",
	"2a0d:f407:1025::/48",
	"2a0d:f407:1033::/48",
	"2a0d:f407:1049::/48"
];

module.exports = (rangeList) => {
	const ranges = rangeList || DEFAULT_RANGES;

	return {
		getRandomIP: () => {
			const range = ranges[Math.floor(Math.random() * ranges.length)];

			return ip(range).random();
		}
	};
};
