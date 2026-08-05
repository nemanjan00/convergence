const blocks = require("../index");

// The network blocks are exercised live by `yarn flow`; here we only assert the
// OFFLINE contract that keeps convergence safe: a missing/empty input yields no
// fields (never throws, never blocks the fixpoint). No network is touched.
describe("network blocks — offline tolerance", () => {
	const map = blocks.allMap();

	[
		"dns.a", "dns.aaaa", "dns.txt", "dns.ns", "dns.cname", "dns.caa", "dns.soa",
		"dns.srv", "dns.spf-expand", "ct.subdomains", "passive.hackertarget",
		"passive.rapiddns", "port.scan", "port.banner", "http.title", "http.headers",
		"http.robots", "http.security-txt", "http.favicon", "http.redirects",
		"http.links", "http.cookies", "http.dirdig", "http.request", "http.wayback", "http.crawl",
		"http.sitemap", "http.emails", "http.forms", "http.meta", "http.waf",
		"http.cors", "rdap", "rdap.domain", "ip.asn", "asn.prefixes", "asn.info",
		"ip.geo", "ip.reverse", "ip.ripestat", "ip.neighbors", "internetdb",
		"mail.dnsbl", "tls.cert", "tls.versions", "tls.spki", "cert.parse",
		"ti.greynoise", "ti.urlhaus", "http.paths", "http.json", "mail.mx",
		"mail.auth", "url.parse", "email.parse", "hash.digest", "decode", "refang",
		"exif", "webhook", "cli"
	].forEach((name) => {
		it(name + " is registered", () => {
			expect(map[name]).toBeDefined();
		});

		it(name + " returns no fields for empty input", () => {
			return map[name].handler({}).then((fields) => {
				expect(fields).toEqual({});
			});
		});
	});
});
