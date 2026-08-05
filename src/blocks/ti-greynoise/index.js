// Block: ti.greynoise — GreyNoise Community verdict for an IP (key-free): is this
// address a known internet-wide scanner, and is it benign (RIOT — common
// business services like Google/CDNs) or malicious? In forensics this quickly
// separates "background noise" from a targeted actor. `classification`/`noise`/
// `riot` returned; a 404 means "not observed" => {}. Via services/http. Tolerant.

const http = require("../../services/http");

module.exports = {
	uses: "ti.greynoise",
	rate: { maxConcurrent: 4 },
	handler: (input) => {
		const ip = input.ip || input.address;

		if (!ip) {
			return Promise.resolve({});
		}

		return http.getJson("https://api.greynoise.io/v3/community/" + encodeURIComponent(ip), {
			headers: { accept: "application/json" }
		}).then((data) => {
			if (!data) {
				return {};
			}

			const fields = {};

			if (data.classification) { fields.greynoise_class = data.classification; }
			if (data.name) { fields.greynoise_name = data.name; }
			if (data.noise !== undefined) { fields.greynoise_noise = data.noise; }
			if (data.riot !== undefined) { fields.greynoise_riot = data.riot; }
			if (data.last_seen) { fields.greynoise_last_seen = data.last_seen; }

			return fields;
		});
	}
};
