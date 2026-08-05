// IP address framework (v4 + v6). Central to recon: mask, enumerate containing
// networks, test subnet membership, and answer "does this range contain that
// address". Accepts a bare address ("1.2.3.4", "2606:4700::1") or a CIDR
// ("1.2.3.0/24"). Wraps ipaddr.js.
//
//   ip("93.184.216.34").mask(24)                 // "93.184.216.0"
//   ip("93.184.216.34").isInSubnet("93.184.216.0/24")  // true
//   ip("93.184.216.0/24").contains("93.184.216.5")     // true
//   ip("93.184.216.34").nets()                   // ["…/1", …, "…/32"]

const crypto = require("crypto");
const ipUtil = require("ipaddr.js");

module.exports = (input) => {
	const ip = {
		_kind: undefined,
		_buffer: undefined,
		_parsed: undefined,
		_prefix: undefined, // set when constructed from a CIDR

		_init: (value) => {
			if (String(value).indexOf("/") !== -1) {
				const parts = ipUtil.parseCIDR(value);
				ip._parsed = parts[0];
				ip._prefix = parts[1];
			} else {
				ip._parsed = ipUtil.parse(value);
			}

			ip._kind = ip._parsed.kind();
			ip._buffer = Buffer.from(ip._parsed.toByteArray());
		},

		kind: () => {
			return ip._kind;
		},

		version: () => {
			return ip._kind === "ipv6" ? 6 : 4;
		},

		isV4: () => {
			return ip._kind === "ipv4";
		},

		isV6: () => {
			return ip._kind === "ipv6";
		},

		// Prefix length when built from a CIDR, else null.
		prefix: () => {
			return ip._prefix === undefined ? null : ip._prefix;
		},

		toString: () => {
			return ip._parsed.toString();
		},

		toByteArray: () => {
			return Array.from(ip._buffer);
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

		// Network address for this CIDR (or /full-length when bare).
		network: () => {
			const bits = ip._prefix === undefined ? ip._buffer.length * 8 : ip._prefix;

			return ip.mask(bits);
		},

		// A random address within this CIDR: keep the network bits, randomise the
		// host bits (same binary op for v4 and v6). A bare address has no host
		// bits, so it returns itself. Used for egress-address rotation.
		random: () => {
			const totalBits = ip._buffer.length * 8;
			const prefix = ip._prefix === undefined ? totalBits : ip._prefix;
			const buffer = Buffer.from(ipUtil.parse(ip.network()).toByteArray());
			const hostBits = totalBits - prefix;

			if (hostBits <= 0) {
				return ipUtil.fromByteArray(Array.from(buffer)).toString();
			}

			const hostByteCount = Math.ceil(hostBits / 8);
			const random = crypto.randomBytes(hostByteCount);

			// Zero the bits of the top random byte that fall inside the prefix.
			const overhang = hostByteCount * 8 - hostBits;
			random[0] &= 0xff >> overhang;

			for (let i = 0; i < hostByteCount; i++) {
				buffer[buffer.length - 1 - i] |= random[hostByteCount - 1 - i];
			}

			return ipUtil.fromByteArray(Array.from(buffer)).toString();
		},

		// Every containing network, from /1 down to the full address length.
		nets: () => {
			const bits = ip._buffer.length * 8;

			return Array(bits).fill(true).map((_flag, key) => {
				return ip.mask(key + 1) + "/" + (key + 1);
			});
		},

		// Is this address inside the given CIDR? (false across families.)
		isInSubnet: (cidr) => {
			const parts = ipUtil.parseCIDR(cidr);

			if (parts[0].kind() !== ip._kind) {
				return false;
			}

			return ip._parsed.match(parts[0], parts[1]);
		},

		// Does this CIDR contain the given address? Requires a CIDR construction.
		contains: (other) => {
			if (ip._prefix === undefined) {
				throw new Error("contains() requires a CIDR, e.g. ip(\"1.2.3.0/24\")");
			}

			const otherParsed = ipUtil.parse(other);

			if (otherParsed.kind() !== ip._kind) {
				return false;
			}

			return otherParsed.match(ip._parsed, ip._prefix);
		}
	};

	ip._init(input);

	return ip;
};
