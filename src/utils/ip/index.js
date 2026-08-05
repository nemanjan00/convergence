// IP address helper (v4 + v6). Wraps ipaddr.js to mask an address to a prefix
// length and to enumerate every containing network — used for matching an IP
// against whois/ASN ranges and for range-oriented recon.
//
// Usage:
//   const addr = ip("93.184.216.34");
//   addr.mask(24);   // -> "93.184.216.0"
//   addr.nets();     // -> ["93.184.216.34/1", ... , ".../32"]

const ipUtil = require("ipaddr.js");

module.exports = (realIp) => {
	const ip = {
		_kind: undefined,
		_buffer: undefined,
		_parsed: undefined,

		_init: (value) => {
			const parsed = ipUtil.parse(value);

			ip._kind = parsed.kind();
			ip._buffer = Buffer.from(parsed.toByteArray());
			ip._parsed = parsed;
		},

		kind: () => {
			return ip._kind;
		},

		toString: () => {
			return ip._parsed.toString();
		},

		// Zero out all bits below the given prefix length.
		mask: (initialMaskSize) => {
			let maskSize = initialMaskSize;
			const buffer = Buffer.from(ip._buffer.toString("hex"), "hex");

			const mask = Array(buffer.length)
				.fill(0)
				.map(() => {
					const take = Math.min(maskSize, 8);
					maskSize = maskSize - take;

					return parseInt(Array(take).fill("1").join("").padEnd(8, "0"), 2);
				});

			buffer.forEach((_byte, key) => {
				buffer[key] &= mask[key];
			});

			return ipUtil.fromByteArray(Array.from(buffer)).toString();
		},

		// Every containing network, from /1 down to the full address length.
		nets: () => {
			const bits = ip._buffer.length * 8;

			return Array(bits).fill(true).map((_flag, key) => {
				return ip.mask(key + 1) + "/" + (key + 1);
			});
		}
	};

	ip._init(realIp);

	return ip;
};
