// Generate a random source IP inside one of a set of owned ranges — used for
// egress-address rotation so outbound recon spreads across an owned prefix
// instead of a single address. Works for both IPv4 and IPv6: it is the same
// binary operation (keep the network bits, randomise the host bits), only the
// address width differs.
//
// Pass ranges (CIDR strings, mixed families allowed). Defaults to a placeholder
// IPv6 set. TODO: source owned ranges from config, not code.

const crypto = require("crypto");
const Address4 = require("ip-address").Address4;
const Address6 = require("ip-address").Address6;

const DEFAULT_RANGES = [
	"2a0d:f407:1006::/48",
	"2a0d:f407:1017::/48",
	"2a0d:f407:1025::/48",
	"2a0d:f407:1033::/48",
	"2a0d:f407:1049::/48"
];

// Normalise a CIDR to { bytes (network, host-zeroed), prefix, kind }.
const parseRange = (cidr) => {
	if (cidr.indexOf(":") !== -1) {
		const address = new Address6(cidr);

		return {
			bytes: address.toUnsignedByteArray(),
			prefix: address.parsedSubnet === "" ? 128 : Number(address.parsedSubnet),
			kind: "ipv6"
		};
	}

	const address = new Address4(cidr);

	return {
		bytes: address.toArray(),
		prefix: Number(address.subnetMask),
		kind: "ipv4"
	};
};

// Render network bytes back to an address string for the given family.
const toAddress = (bytes, kind) => {
	if (kind === "ipv6") {
		return Address6.fromUnsignedByteArray(Uint8Array.from(bytes)).address;
	}

	return bytes.join(".");
};

module.exports = (rangeList) => {
	const ranges = (rangeList || DEFAULT_RANGES).map(parseRange);

	const generator = {
		getRandomIP: () => {
			const range = ranges[Math.floor(Math.random() * ranges.length)];
			const buffer = Buffer.from(range.bytes);
			const totalBits = buffer.length * 8;
			const hostBits = totalBits - range.prefix;

			if (hostBits <= 0) {
				return toAddress(Array.from(buffer), range.kind);
			}

			const hostByteCount = Math.ceil(hostBits / 8);
			const random = crypto.randomBytes(hostByteCount);

			// The highest random byte may straddle the prefix boundary; zero the
			// bits that belong to the network so they are left untouched.
			const overhang = hostByteCount * 8 - hostBits;
			random[0] &= 0xff >> overhang;

			// OR the random host bits into the low bytes of the network address.
			for (let i = 0; i < hostByteCount; i++) {
				buffer[buffer.length - 1 - i] |= random[hostByteCount - 1 - i];
			}

			return toAddress(Array.from(buffer), range.kind);
		}
	};

	return generator;
};
