// Block: dns.srv — discover services published in DNS via SRV records. Given a
// domain it probes the common service names (SIP, XMPP, LDAP, Kerberos,
// Autodiscover, MS-DC, caldav…); each hit exposes a target host + port, and the
// target types -> host so a mail/VoIP/AD backend becomes its own node. You can
// also pass an explicit `name` (a full _service._proto.domain). Via the rotating
// resolver. Tolerant: nothing found => {}.

const resolver = require("../../services/resolver");

const COMMON = [
	"_sip._tcp", "_sips._tcp", "_sip._udp",
	"_xmpp-client._tcp", "_xmpp-server._tcp",
	"_ldap._tcp", "_kerberos._tcp", "_kerberos._udp", "_kpasswd._tcp",
	"_autodiscover._tcp", "_caldav._tcp", "_carddav._tcp",
	"_imaps._tcp", "_submission._tcp", "_pop3s._tcp",
	"_ldap._tcp.dc._msdcs", "_gc._tcp"
];

module.exports = {
	uses: "dns.srv",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const domain = String(input.domain || input.name || "").replace(/^\*\./, "").trim();

		if (!domain) {
			return Promise.resolve({});
		}

		// If given a full SRV name query it directly; else expand the common set.
		const names = input.name && input.name.indexOf("_") === 0
			? [input.name]
			: COMMON.map((service) => { return service + "." + domain; });

		return Promise.all(names.map((name) => {
			return resolver.resolveSrv(name).then((records) => {
				return records.map((record) => {
					return { service: name, target: record.name, port: record.port };
				});
			}).catch(() => { return []; });
		})).then((results) => {
			const found = results.flat();

			if (found.length === 0) {
				return {};
			}

			return {
				srv: found,
				srv_targets: Array.from(new Set(found.map((record) => { return record.target; })))
			};
		});
	}
};
