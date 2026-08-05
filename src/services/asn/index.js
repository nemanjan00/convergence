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
			let settled = false;

			// Single settle so a socket/readline error can't double-reject, and
			// swallow the readline 'error' event (otherwise Node throws it as an
			// unhandled 'error' that bypasses this promise and crashes the run).
			const done = (error) => {
				if (settled) { return; }
				settled = true;
				socket.destroy();

				if (error) {
					return reject(error);
				}

				resolve(data);
			};

			rl.on("error", done);

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
					return done(new Error("Team Cymru returned a malformed line"));
				}

				done();
			});

			socket.on("error", done);

			socket.on("connect", () => {
				socket.write("begin\nprefix\n" + list.join("\n") + "\nend\n");
			});
		});
	}
};

module.exports = asn;
