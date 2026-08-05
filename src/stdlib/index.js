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
const randomIp = require("../utils/random-ip");

const stdlib = {
	ip: ip,           // ip(addr|cidr) -> mask/nets/isInSubnet/contains/...
	subnet: subnet,   // subnet(counts, network) -> VLSM layout
	geo: geo,         // geo.findNearestCountry(...)
	balancer: balancer, // balancer() -> weighted-random pool
	randomIp: randomIp  // randomIp(ranges) -> { getRandomIP() }
};

module.exports = stdlib;
