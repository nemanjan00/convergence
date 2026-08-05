// Block: port.banner — grab the service banner from a single TCP port. Where
// port.scan answers "is it open", this answers "what is it": it connects, reads
// the greeting a service volunteers (SSH ident, SMTP 220, FTP 220, Redis, etc.),
// and for silent services (HTTP) nudges with a minimal request so the server
// says something. No root, no nmap — a plain socket with a short read window, so
// it composes with the engine's rate limiting. Tolerant: nothing read => {}.

const net = require("net");

const DEFAULT_PORT = 22;
const CONNECT_TIMEOUT_MS = 3000;
const READ_WINDOW_MS = 1500;
const MAX_BANNER = 512;

// Services that speak first need no prompt; quiet ones get a nudge so they
// reply. Keyed by port; HTTP ports get a bare request line.
const NUDGE = { 80: "HEAD / HTTP/1.0\r\n\r\n", 8080: "HEAD / HTTP/1.0\r\n\r\n" };

module.exports = {
	uses: "port.banner",
	rate: { maxConcurrent: 10 },
	handler: (input) => {
		const host = input.target || input.host;
		const port = Number(input.port) || DEFAULT_PORT;

		if (!host) {
			return Promise.resolve({});
		}

		return new Promise((resolve) => {
			const socket = net.connect({ host: host, port: port });
			let banner = "";
			let settled = false;

			const finish = () => {
				if (settled) { return; }
				settled = true;
				socket.destroy();

				const clean = banner.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_BANNER);

				resolve(clean ? { port: port, banner: clean } : {});
			};

			socket.setTimeout(CONNECT_TIMEOUT_MS);

			socket.on("connect", () => {
				// Give a talkative service a moment; prompt a quiet one.
				if (NUDGE[port]) { socket.write(NUDGE[port]); }
				setTimeout(finish, READ_WINDOW_MS);
			});

			socket.on("data", (chunk) => {
				banner = banner + chunk.toString("utf8");

				if (banner.length >= MAX_BANNER) { finish(); }
			});

			socket.on("timeout", finish);
			socket.on("error", finish);
			socket.on("close", finish);
		});
	}
};
