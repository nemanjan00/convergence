// Block: port.scan — native TCP connect scan of a small port set. No nmap, no
// root: a plain socket connect with a short timeout, so it composes with the
// engine's rate limiting and (later) egress-IP rotation. Returns the open ports
// and simple service labels. Tolerant: unreachable target -> no open ports.

const net = require("net");

const PORTS = [80, 443, 22, 25, 8080, 8443];
const SERVICE = { 80: "http", 443: "https", 22: "ssh", 25: "smtp", 8080: "http-alt", 8443: "https-alt" };
const TIMEOUT_MS = 2000;

const probe = (host, port) => {
	return new Promise((resolve) => {
		const socket = net.connect({ host: host, port: port });
		let settled = false;

		const finish = (open) => {
			if (settled) { return; }
			settled = true;
			socket.destroy();
			resolve(open ? port : null);
		};

		socket.setTimeout(TIMEOUT_MS);
		socket.on("connect", () => { finish(true); });
		socket.on("timeout", () => { finish(false); });
		socket.on("error", () => { finish(false); });
	});
};

module.exports = {
	uses: "port.scan",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const host = input.target;

		if (!host) {
			return Promise.resolve({});
		}

		return Promise.all(PORTS.map((port) => {
			return probe(host, port);
		})).then((results) => {
			const open = results.filter((port) => {
				return port !== null;
			});

			return {
				open_ports: open,
				services: open.map((port) => {
					return { port: port, name: SERVICE[port] };
				})
			};
		});
	}
};
