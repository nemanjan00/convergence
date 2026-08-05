// ASN + prefix lookup via the Team Cymru bulk whois interface (whois.cymru.com
// port 43). Given a list of IPs, returns { ip -> { asn, ip, prefix, asnName } }
// in a single bulk query. Connections resolve the whois host through the
// process DNS cache.
//
// https://www.team-cymru.com/ip-asn-mapping

const net = require("net");
const readline = require("readline");
const cacheable = require("../../utils/dns-cache");

const CYMRU_HOST = "whois.cymru.com";
const CYMRU_PORT = 43;
const EXPECTED_SEGMENTS = 4;

const asn = {
	resolve: (list) => {
		return new Promise((resolve, reject) => {
			const socket = net.connect({
				port: CYMRU_PORT,
				host: CYMRU_HOST,
				lookup: cacheable.lookup
			});

			const rl = readline.createInterface({ input: socket });
			const data = {};
			let malformed = false;

			rl.on("line", (line) => {
				if (line.indexOf("Bulk mode") !== -1) {
					return;
				}

				const segments = line.split("|").map((segment) => {
					return segment.trim();
				});

				if (segments.length !== EXPECTED_SEGMENTS) {
					// Surface the error instead of killing the process (the
					// original called process.exit(1) here).
					malformed = true;
					return;
				}

				const map = {
					asn: segments[0],
					ip: segments[1],
					prefix: segments[2],
					asnName: segments[3]
				};

				data[map.ip] = map;
			});

			rl.on("close", () => {
				if (malformed) {
					return reject(new Error("Team Cymru returned a malformed line"));
				}

				resolve(data);
			});

			socket.on("error", (error) => {
				reject(error);
			});

			socket.on("connect", () => {
				socket.write("begin\nprefix\n" + list.join("\n") + "\nend\n");
			});
		});
	}
};

module.exports = asn;
