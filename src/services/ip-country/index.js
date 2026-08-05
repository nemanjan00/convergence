// Map an IP to the country that announces it, by matching the IP's containing
// networks against a country -> prefixes dataset (ipverse/country-ip-blocks,
// preprocessed to <cc>/aggregated.json with { country_code, prefixes: { ipv4,
// ipv6 } }).
//
// The dataset is loaded lazily and tolerantly: if COUNTRY_IP_PATH points at a
// directory that does not exist, lookups simply return false instead of
// throwing at require time. Defaults to a small bundled sample.
//
// TODO: point COUNTRY_IP_PATH at a full country-ip-blocks / rir-ip checkout.

const fs = require("fs");
const path = require("path");
const config = require("../../config");
const ip = require("../../utils/ip");

const DEFAULT_BASE = path.join(__dirname, "../../../data/rir-ip-sample/country");

const ipCountry = {
	_ranges: undefined,

	// Build { ipv4: {cidr -> country}, ipv6: {cidr -> country} } once.
	_load: () => {
		if (ipCountry._ranges) {
			return ipCountry._ranges;
		}

		const base = config.get("COUNTRY_IP_PATH") || DEFAULT_BASE;
		const ranges = { ipv4: {}, ipv6: {} };

		if (!fs.existsSync(base)) {
			console.error("ip-country: dataset not found at " + base);
			ipCountry._ranges = ranges;

			return ranges;
		}

		fs.readdirSync(base).forEach((countryCode) => {
			const file = path.join(base, countryCode, "aggregated.json");

			if (!fs.existsSync(file)) {
				return;
			}

			const country = JSON.parse(fs.readFileSync(file).toString("utf8"));

			country.prefixes.ipv4.forEach((range) => {
				ranges.ipv4[range] = country;
			});

			country.prefixes.ipv6.forEach((range) => {
				ranges.ipv6[range] = country;
			});
		});

		ipCountry._ranges = ranges;

		return ranges;
	},

	// Most specific matching network for an IP, or false.
	_matchingNets: (ipAddr) => {
		const ranges = ipCountry._load();
		const userIp = ip(ipAddr);
		const kind = userIp.kind();

		return userIp.nets().filter((net) => {
			return ranges[kind][net];
		});
	},

	getCountry: (ipAddr) => {
		const ranges = ipCountry._load();
		const userIp = ip(ipAddr);
		const kind = userIp.kind();
		const matches = ipCountry._matchingNets(ipAddr);

		if (matches.length === 0) {
			return false;
		}

		return ranges[kind][matches.pop()];
	},

	getRange: (ipAddr) => {
		const matches = ipCountry._matchingNets(ipAddr);

		if (matches.length === 0) {
			return false;
		}

		return matches.pop();
	}
};

module.exports = ipCountry;
