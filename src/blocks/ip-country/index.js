// Block: ip.country — given an IP, attach the country that announces it. Named
// for its SUBJECT (ip), not a generic "enrich": a country lookup for a person or
// a domain would be entirely different logic and a different block.
//
// A block is a SELF-CONTAINED module that owns its dependencies; the registry
// loads it tolerantly, so a block whose external dep is missing disables only
// itself. This one wraps the offline ip-country service, so it always loads.

const ipCountry = require("../../services/ip-country");

module.exports = {
	uses: "ip.country",
	// No network — the dataset is local — so no rate limit needed.
	rate: {},
	handler: (input) => {
		const country = ipCountry.getCountry(input.ip);

		if (!country) {
			return Promise.resolve({});
		}

		return Promise.resolve({
			country_code: country.country_code
		});
	}
};
