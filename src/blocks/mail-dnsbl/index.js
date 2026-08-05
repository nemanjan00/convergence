// Block: mail.dnsbl — check an IP against DNS blocklists (Spamhaus ZEN,
// Barracuda, SpamCop, …). A reputation signal for forensics/mail recon: a listed
// IP is a known spam/abuse source. Works by the classic reversed-octet A-record
// query (a listing resolves to 127.0.0.x) — pure DNS, no key. Tolerant: not
// listed / lookup blocked => {}. (Public DNSBLs may refuse datacenter resolvers;
// a clean result is not proof of innocence.)

const dns = require("dns").promises;

const ZONES = [
	"zen.spamhaus.org",
	"b.barracudacentral.org",
	"bl.spamcop.net",
	"dnsbl.sorbs.net"
];

const reverse = (ip) => {
	return ip.split(".").reverse().join(".");
};
const host = require("../../utils/host");

module.exports = {
	uses: "mail.dnsbl",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const ip = host.ip(input);

		// v4 only — the reversed-nibble v6 form is a separate (rare) path.
		if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(String(ip))) {
			return Promise.resolve({});
		}

		const prefix = reverse(String(ip)) + ".";

		return Promise.all(ZONES.map((zone) => {
			return dns.resolve4(prefix + zone).then((answers) => {
				return answers.length > 0 ? zone : null;
			}).catch(() => { return null; });
		})).then((results) => {
			const listed = results.filter(Boolean);

			if (listed.length === 0) {
				return {};
			}

			return { dnsbl_listed: listed, dnsbl_count: listed.length };
		});
	}
};
