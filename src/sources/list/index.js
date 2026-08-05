// Source: source.list — the pull side of the ingest standard. Emits a caller-
// provided list of items as entities (verbatim), so any upstream analysis can
// seed the graph: e.g. a malware report of IPs, each with per-IP key/value
// metadata, becomes `ip` entities carrying that metadata (provenanced to the
// source) and ready for enrichment.
//
// params.items: [ { <keyField>: ..., ...metadata } ]

module.exports = {
	source: "source.list",
	pull: (params) => {
		return Promise.resolve((params && params.items) || []);
	}
};
