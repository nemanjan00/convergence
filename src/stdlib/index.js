// Script-block standard library. This is the CURATED, safe-to-expose surface of
// helpers made available to in-flow JavaScript blocks (block.js). It is
// deliberately separate from internal plumbing (utils/envelope, utils/load,
// utils/template, services/*) which script blocks must NOT touch.
//
// Everything here is pure or side-effect-free data tooling: no network, no
// filesystem, no cache/store access. A script block gets exactly these names as
// globals plus its resolved `input`. Grow this surface as script blocks need
// more — that is the whole point of keeping it in one place.

const ip = require("../utils/ip");
const subnet = require("../utils/subnet");
const geo = require("../utils/geo");
const balancer = require("../utils/balancer");

// 32-bit multiply that stays exact by splitting into 16-bit halves (a plain
// a * b overflows the float mantissa well before 2^32).
const mul32 = (a, b) => {
	const aHi = (a >>> 16) & 0xffff;
	const aLo = a & 0xffff;

	return (((aLo * b) >>> 0) + (((aHi * b) & 0xffff) << 16)) >>> 0;
};

const rotl32 = (x, r) => {
	return ((x << r) | (x >>> (32 - r))) >>> 0;
};

// MurmurHash3 x86_32, returning a SIGNED 32-bit int — bit-for-bit compatible
// with Python's `mmh3.hash` and therefore with Shodan's `http.favicon.hash`,
// which is why it lives here (the favicon block hashes the base64 body with it).
// `key` is a Buffer or string; `seed` defaults to 0.
const mmh3 = (key, seed) => {
	const data = Buffer.isBuffer(key) ? key : Buffer.from(String(key), "utf8");
	const len = data.length;
	const nblocks = len >> 2;
	const c1 = 0xcc9e2d51;
	const c2 = 0x1b873593;

	let h1 = (seed || 0) >>> 0;

	for (let i = 0; i < nblocks; i++) {
		let k1 = data.readUInt32LE(i * 4);

		k1 = mul32(k1, c1);
		k1 = rotl32(k1, 15);
		k1 = mul32(k1, c2);

		h1 = (h1 ^ k1) >>> 0;
		h1 = rotl32(h1, 13);
		h1 = (mul32(h1, 5) + 0xe6546b64) >>> 0;
	}

	const tail = nblocks * 4;
	const rem = len & 3;
	let k1 = 0;

	if (rem === 3) { k1 = (k1 ^ (data[tail + 2] << 16)) >>> 0; }
	if (rem >= 2) { k1 = (k1 ^ (data[tail + 1] << 8)) >>> 0; }

	if (rem >= 1) {
		k1 = (k1 ^ data[tail]) >>> 0;
		k1 = mul32(k1, c1);
		k1 = rotl32(k1, 15);
		k1 = mul32(k1, c2);
		h1 = (h1 ^ k1) >>> 0;
	}

	h1 = (h1 ^ len) >>> 0;
	h1 = (h1 ^ (h1 >>> 16)) >>> 0;
	h1 = mul32(h1, 0x85ebca6b);
	h1 = (h1 ^ (h1 >>> 13)) >>> 0;
	h1 = mul32(h1, 0xc2b2ae35);
	h1 = (h1 ^ (h1 >>> 16)) >>> 0;

	// Reinterpret as signed 32-bit (mmh3/Shodan report the signed value).
	return h1 | 0;
};

const stdlib = {
	ip: ip,           // ip(addr|cidr) -> mask/nets/isInSubnet/contains/random; ip.randomFrom(ranges)
	subnet: subnet,   // subnet(counts, network) -> VLSM layout
	geo: geo,         // geo.findNearestCountry(...)
	balancer: balancer, // balancer() -> weighted-random pool
	mmh3: mmh3        // mmh3(key[, seed]) -> signed 32-bit MurmurHash3 (Shodan favicon hash)
};

module.exports = stdlib;
