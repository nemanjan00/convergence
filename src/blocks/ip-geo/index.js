// Block: ip.geo — geolocation + hosting org for an IP (ip-api.com, free, no
// key). Useful in forensics to place a malware C2/IP: country, city, ISP/org.
// Tolerant: failures / rate-limits return no fields.

const TIMEOUT_MS = 6000;
const FIELDS = "status,country,countryCode,city,isp,org,as";

module.exports = {
	uses: "ip.geo",
	rate: { maxConcurrent: 5, maxPerMin: 40 },
	handler: (input) => {
		const address = input.address;

		if (!address) {
			return Promise.resolve({});
		}

		// ip-api's free tier is HTTP-only.
		const url = "http://ip-api.com/json/" + encodeURIComponent(address) + "?fields=" + FIELDS;

		return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then((response) => {
			return response.json();
		}).then((data) => {
			if (!data || data.status !== "success") {
				return {};
			}

			return {
				country: data.country,
				country_code: data.countryCode,
				city: data.city,
				isp: data.isp,
				org: data.org
			};
		}).catch(() => {
			return {};
		});
	}
};
