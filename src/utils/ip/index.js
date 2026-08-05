// IP address framework (v4 + v6). Central to recon: mask, enumerate containing
// networks, test subnet membership, ask "does this range contain that address",
// and generate a random address within a range. Accepts a bare address
// ("1.2.3.4", "2606:4700::1") or a CIDR ("1.2.3.0/24"). Wraps ipaddr.js.
//
// The logic is family-AGNOSTIC: v4 and v6 share one code path, and the only
// difference lives in the per-family constants below (width in bits/bytes).
//
//   ip("93.184.216.34").mask(24)                       // "93.184.216.0"
//   ip("93.184.216.34").isInSubnet("93.184.216.0/24")  // true
//   ip("93.184.216.0/24").contains("93.184.216.5")     // true
//   ip("93.184.216.0/24").random()                     // random addr in range
//   ip.randomFrom(["2a0d:f407:1006::/48", "1.2.3.0/24"]) // random range + addr

const crypto = require("crypto");
const ipUtil = require("ipaddr.js");

// Per-family constants — the ONLY place v4 and v6 differ.
const FAMILY = {
	ipv4: { version: 4, bytes: 4, bits: 32 },
	ipv6: { version: 6, bytes: 16, bits: 128 }
};

const ip = (input) => {
	const instance = {
		_kind: undefined,
		_buffer: undefined,
		_parsed: undefined,
		_prefix: undefined, // set when constructed from a CIDR

		_init: (value) => {
			if (String(value).indexOf("/") !== -1) {
				const parts = ipUtil.parseCIDR(value);
				instance._parsed = parts[0];
				instance._prefix = parts[1];
			} else {
				instance._parsed = ipUtil.parse(value);
			}

			instance._kind = instance._parsed.kind();
			instance._buffer = Buffer.from(instance._parsed.toByteArray());
		},

		_bits: () => {
			return FAMILY[instance._kind].bits;
		},

		kind: () => {
			return instance._kind;
		},

		version: () => {
			return FAMILY[instance._kind].version;
		},

		isV4: () => {
			return instance._kind === "ipv4";
		},

		isV6: () => {
			return instance._kind === "ipv6";
		},

		// Prefix length when built from a CIDR, else null.
		prefix: () => {
			return instance._prefix === undefined ? null : instance._prefix;
		},

		toString: () => {
			return instance._parsed.toString();
		},

		toByteArray: () => {
			return Array.from(instance._buffer);
		},

		// Zero out all bits below the given prefix length.
		mask: (initialMaskSize) => {
			let maskSize = initialMaskSize;
			const buffer = Buffer.from(instance._buffer.toString("hex"), "hex");

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

		// Network address for this CIDR (or /full-length when bare).
		network: () => {
			const bits = instance._prefix === undefined ? instance._bits() : instance._prefix;

			return instance.mask(bits);
		},

		// A random address within this CIDR: keep the network bits, randomise the
		// host bits. Family-agnostic (widths come from FAMILY). Host bits use
		// crypto random bytes for a uniform, unpredictable distribution. A bare
		// address has no host bits, so it returns itself.
		random: () => {
			const bits = instance._bits();
			const prefix = instance._prefix === undefined ? bits : instance._prefix;
			const buffer = Buffer.from(ipUtil.parse(instance.network()).toByteArray());
			const hostBits = bits - prefix;

			if (hostBits <= 0) {
				return ipUtil.fromByteArray(Array.from(buffer)).toString();
			}

			const hostByteCount = Math.ceil(hostBits / 8);
			const randomBytes = crypto.randomBytes(hostByteCount);

			// Zero the bits of the top random byte that fall inside the prefix.
			const overhang = hostByteCount * 8 - hostBits;
			randomBytes[0] &= 0xff >> overhang;

			for (let i = 0; i < hostByteCount; i++) {
				buffer[buffer.length - 1 - i] |= randomBytes[hostByteCount - 1 - i];
			}

			return ipUtil.fromByteArray(Array.from(buffer)).toString();
		},

		// Every containing network, from /1 down to the full address length.
		nets: () => {
			return Array(instance._bits()).fill(true).map((_flag, key) => {
				return instance.mask(key + 1) + "/" + (key + 1);
			});
		},

		// Is this address inside the given CIDR? (false across families.)
		isInSubnet: (cidr) => {
			const parts = ipUtil.parseCIDR(cidr);

			if (parts[0].kind() !== instance._kind) {
				return false;
			}

			return instance._parsed.match(parts[0], parts[1]);
		},

		// Does this CIDR contain the given address? Requires a CIDR construction.
		contains: (other) => {
			if (instance._prefix === undefined) {
				throw new Error("contains() requires a CIDR, e.g. ip(\"1.2.3.0/24\")");
			}

			const otherParsed = ipUtil.parse(other);

			if (otherParsed.kind() !== instance._kind) {
				return false;
			}

			return otherParsed.match(instance._parsed, instance._prefix);
		}
	};

	instance._init(input);

	return instance;
};

// Egress-range rotation: pick one of a set of owned ranges (mixed v4/v6 allowed)
// and return a random address inside it. Ranges are deployment config supplied
// by the caller — the framework does not bake any in.
ip.randomFrom = (ranges) => {
	const range = ranges[Math.floor(Math.random() * ranges.length)];

	return ip(range).random();
};

module.exports = ip;
