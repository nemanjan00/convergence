// Sample playbooks — the bundled example flows, offered in the UI as one-click
// importable starting points (a "template gallery"). Read straight from
// examples/flows so the samples never drift from the canonical flows.

const fs = require("fs");
const path = require("path");
const loader = require("../loader");

const FLOWS_DIR = path.join(__dirname, "../../examples/flows");

// Short human descriptions keyed by flow file (falls back to the flow's own
// metadata.description).
const BLURBS = {
	"ct-recon.yaml": "Certificate Transparency recon: a domain's certs fan out to hosts, each enriched via DNS / RDAP / ports / TLS / HTTP.",
	"ip-forensics.yaml": "Forensics enrichment: a list of IPs (with analyst metadata) grows into a graph — owner, ASN, geo, ports, reverse-DNS."
};

const samples = {
	// [{ name, description, yaml }] — importable portable artifacts.
	all: () => {
		let files;

		try {
			files = fs.readdirSync(FLOWS_DIR).filter((file) => { return /\.ya?ml$/.test(file); });
		} catch {
			return [];
		}

		return files.map((file) => {
			const yaml = fs.readFileSync(path.join(FLOWS_DIR, file)).toString("utf8");
			let name = file.replace(/\.ya?ml$/, "");
			let description = BLURBS[file] || "";

			try {
				const spec = loader.parse(yaml);

				if (spec && spec.metadata) {
					name = spec.metadata.name || name;
					description = description || spec.metadata.description || "";
				}
			} catch {
				// keep filename-derived name on an unparseable sample
			}

			return { name: name, description: description, yaml: yaml };
		});
	}
};

module.exports = samples;
