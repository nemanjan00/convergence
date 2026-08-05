// Deterministic, offline stand-in blocks so the demo and tests run with no
// network. Each returns a Promise<fields> — the exact handler shape the runtime
// registers. Real blocks live under src/services/* and hit the network.
//
// TODO(blocks): replace these with real blocks backed by services:
//   rdap (rdap), dns (dns.a), nmap (port.scan),
//   wappalyzer (http.wappalyzer), http-title (http.title), and the
//   source.ct-log streaming source.

// Tiny deterministic hash so stub outputs vary per input without randomness.
const hashToOctet = (text) => {
	const sum = String(text)
		.split("")
		.reduce((acc, char) => {
			return acc + char.charCodeAt(0);
		}, 0);

	return sum % 254 + 1;
};

const demoBlocks = {
	// rdap — registrar + abuse email for a domain.
	rdap: (input) => {
		return Promise.resolve({
			registrar: "Demo Registrar LLC",
			abuse_email: "abuse@" + input.domain
		});
	},

	// dns.a — resolve a name to an A record. Establishes host identity.
	dnsA: (input) => {
		return Promise.resolve({
			ip: "93.184.216." + hashToOctet(input.name)
		});
	},

	// port.scan — open ports + services for an IP.
	nmap: (input) => {
		return Promise.resolve({
			open_ports: [80, 443],
			services: [{ port: 443, name: "https", product: "nginx", target: input.target }]
		});
	},

	// http.title — grab a page title.
	httpTitle: (input) => {
		return Promise.resolve({
			title: "Welcome to " + input.url
		});
	}
};

module.exports = demoBlocks;
