// Real contract block: enrich.country — given a host's IP, attach the country
// that announces it. Adapts the ip-country service (offline, dataset-backed)
// into the block handler shape the runtime registers: input -> Promise<fields>.
//
// This is the template for wrapping any ported service as a block: pick inputs
// off the work item, call the service, return the fields to merge. Rate limits,
// retries, provenance, and merging are the runtime/store's job, not the block's.

const ipCountry = require("../../services/ip-country");

module.exports = {
	uses: "enrich.country",
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
