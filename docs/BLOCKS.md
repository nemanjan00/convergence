# Block & source catalog

The complete library of **blocks** (enrichers) and **sources** (inputs) shipped
with convergence. This file is the human-facing index; the machine-facing one is
the live registry (`src/blocks`, `src/sources`) — the MCP `list_blocks` tool and
the flow-builder palette derive from it, so they never drift.

> **Keep this updated:** adding a block means adding a row here (it's on the
> `/implement-js` cleanup checklist and in `CLAUDE.md`).

## How blocks work (the contract)

A block is `handler(input) => Promise<fields>`: it takes an entity's resolved
fields as input and returns new fields to merge (with provenance) into an entity.
Key properties every block obeys:

- **Tolerant.** Missing/empty input or any failure resolves to `{}` — a block
  never throws into the engine or stalls the fixpoint. So "no result" and
  "not applicable" both read as "no fields".
- **Idempotent-friendly.** Re-running with the same input yields the same
  fields, so convergence terminates.
- **One field-set, or an array** (fan-out: one entity per element).
- **Typed-field links** grow the graph declaratively: an output field marked
  `{ links: <type>, as, rel }` on the entity spec auto-materializes a linked
  entity + edge. The "→ type" notes below mean "commonly typed to link to that
  entity type".

Predicates everywhere (`when:`, source `filter:`, the `filter` block) are
Mongo-style **sift** queries — the same dialect the explorer and Mongo use.

---

## Sources (inputs)

| source | params | emits | notes |
|---|---|---|---|
| `source.ct-log` | `match_domains[]` | `cert` | Certificate Transparency (crt.sh → CertSpotter fallback); capped, deduped |
| `source.list` | `items[]` | any | Pull side of ingest — emits caller-provided items verbatim (e.g. a malware report's IPs+metadata) |
| `source.webhook` | `items[]` (seed) | any | **Inbound push** — `push(items)` enqueues; `pull()` drains. The served app calls `push()` from its HTTP route |
| `source.tick` | `label`, `items[]` | `tick` | Timestamped heartbeat for time-driven flows (pairs with `bin/monitor.js`) |

---

## Discovery — subdomains & passive DNS

The biggest graph-growers: one domain → many hosts. Run several and merge
(per-source provenance) — each provider has blind spots.

| block | input | output | key-free | notes |
|---|---|---|---|---|
| `ct.subdomains` | `domain` | `subdomains[]` → host, `ct_issuers[]` | ✅ crt.sh | Every name that ever got a cert |
| `passive.hackertarget` | `domain` | `subdomains[]` → host, `ips[]` → ip | ✅ (rate-limited) | Passive DNS: names + A records |
| `passive.rapiddns` | `domain` | `subdomains[]` → host | ✅ (scrape) | Independent third provider |

## DNS records

| block | input | output | notes |
|---|---|---|---|
| `dns.a` | `name` | `ip`, `ips[]` → ip | A records (wildcard-stripped) |
| `dns.aaaa` | `name` | `ip6`, `ip6s[]` → ip | AAAA / IPv6 |
| `dns.txt` | `name` | `txt[]`, `spf` | TXT + SPF pulled out |
| `dns.ns` | `name` | `nameservers[]` → host | Authoritative name servers |
| `dns.cname` | `name` | `cname`, `cnames[]` → host | Alias target (CDN/SaaS pivot) |
| `dns.caa` | `name` | `caa_issue[]`, `caa_issuewild[]`, `caa_iodef[]` | Which CAs may issue |
| `dns.soa` | `name` | `primary_ns` → host, `admin_email` → email, `soa_serial` | Zone authority + admin mailbox |
| `dns.srv` | `domain` \| `name` | `srv[]`, `srv_targets[]` → host | Probes common SRV services (SIP/XMPP/LDAP/…) |
| `dns.spf` | `domain` | `spf[]` | Just the SPF record(s) — expansion is composition (see below), not baked in |

## Mail

| block | input | output | notes |
|---|---|---|---|
| `mail.mx` | `domain` | `mx[]` → host | MX records |
| `mail.auth` | `domain` | `spf`, `dmarc` | SPF/DMARC posture |
| `mail.dnsbl` | `ip` | `dnsbl_listed[]`, `dnsbl_count` | DNS blocklist check (Spamhaus/Barracuda/…) — key-free DNS |

## IP / ASN / network

| block | input | output | key-free | notes |
|---|---|---|---|---|
| `ip.asn` | `ip` | `asn`, `as_name` | ✅ | ASN lookup |
| `ip.geo` | `ip` | `country`, `city`, `lat`, `lon`, `isp` | ✅ ip-api | Geolocation |
| `ip.country` | `ip` | `country_code` | ✅ offline | Bundled country ranges |
| `ip.reverse` | `address` | `hostname`, `hostnames[]` → host | ✅ | PTR / reverse DNS |
| `ip.ripestat` | `ip` | `prefix`, `asn`, `asns[]` → asn | ✅ RIPEstat | Routing/prefix context |
| `ip.neighbors` | `ip` | `neighbor_domains[]` → host | ✅ (rate-limited) | Reverse-IP / shared hosting |
| `internetdb` | `ip` | `open_ports[]`, `cpes[]`, `hostnames[]` → host, `tags[]`, `vulns[]` → cve | ✅ Shodan InternetDB | Cached ports+CVEs, no scan |
| `asn.prefixes` | `asn` | `prefixes[]`, `prefixes_v4[]`, `prefixes_v6[]` → subnet | ✅ RIPEstat | An ASN's announced CIDRs |
| `asn.info` | `asn` | `holder`, `announced`, `asn_type` | ✅ RIPEstat | ASN org name |
| `rdap` | `ip` | `network`, `network_range`, `registrar` | ✅ rdap.org | IP registration (whois successor) |

## Registration (WHOIS/RDAP)

| block | input | output | notes |
|---|---|---|---|
| `rdap.domain` | `domain` | `registrar`, `registered_at`, `expires_at`, `updated_at`, `domain_status[]`, `registrant_emails[]` → email | Domain registration + lifecycle dates |

## TLS / certificates

| block | input | output | notes |
|---|---|---|---|
| `tls.cert` | `host` | `cert_issuer`, `cert_subject`, `cert_not_after`, `cert_sans[]` → host, `cert_emails[]` → email | Live server cert |
| `tls.versions` | `host` | `tls_versions[]`, `tls_weak[]` | Which TLS versions negotiate (weak-proto flag) |
| `tls.spki` | `host` | `spki_sha256`, `cert_fingerprint256` | SPKI hash = cross-host infra pivot |
| `cert.parse` | `pem` | `cert_subject/issuer/not_before/not_after`, `cert_sans[]` → host, `cert_fingerprint256`, `spki_sha256` | Offline PEM parse |

## HTTP / web

| block | input | output | notes |
|---|---|---|---|
| `http.title` | `url` | `title`, `server`, `http_status` | Page title + server header |
| `http.headers` | `url` | `server`, `powered_by`, `hsts`, `csp`, `x_frame_options`, … | Security-header presence |
| `http.cookies` | `url` | `cookies[]` (name/secure/http_only/same_site) | Cookie hygiene + framework tell |
| `http.redirects` | `url` | `final_url`, `final_host` → host, `redirect_chain[]`, `redirect_count` | Redirect chain / off-host pivot |
| `http.links` | `url` | `internal_paths[]`, `external_hosts[]` → host | One-hop link extraction |
| `http.meta` | `url` | `title`, `generator`, `description`, `og{}` | Meta/CMS fingerprint |
| `http.forms` | `url` | `forms[]` (action/method/inputs/kind), `has_login` | Interactive attack surface |
| `http.robots` | `url` | `robots_disallow[]`, `sitemaps[]` | robots.txt leads |
| `http.security-txt` | `url` | `security_emails[]` → email, `security_contacts[]`, `security_expires` | RFC 9116 disclosure contacts |
| `http.favicon` | `url` | `favicon_hash` (mmh3), `favicon_bytes` | Shodan-style favicon pivot |
| `http.sitemap` | `url` | `sitemap_urls[]` → webpage | /sitemap.xml (+index recursion) |
| `http.paths` | `url` | `paths[]` (path/status) | Light dir-buster (tiny wordlist) |
| `http.dirdig` | `url` | `dug_paths[]`, `requests_made` | "dirdigger" — recursive (1-level) prober |
| `http.emails` | `url` | `emails[]` → email | Harvest addresses from a page |
| `http.wayback` | `domain` | `wayback_urls[]` → webpage, `wayback_count` | Wayback CDX historical URLs |
| `http.crawl` | `url` | `crawl_links[]` → webpage (self-feeds!), `title`, `external_hosts[]` → host | **Self-feeding** single-hop; the engine does the BFS, bound via `when:` |
| `http.cors` | `url` | `acao`, `acac`, `cors_issue` | CORS misconfig probe |
| `http.waf` | `url` | `waf`, `waf_all[]` | WAF/CDN detection (passive) |
| `http.json` | `url` | `json`, `http_status` | GET → parsed JSON (pairs with `map`) |
| `http.request` | `url`, `params{}`, `headers{}`, `as` | `<as>` (JSON or text), `http_status` | Generic API caller |

## Threat intel / reputation

| block | input | output | key-free | notes |
|---|---|---|---|---|
| `ti.greynoise` | `ip` | `greynoise_class`, `greynoise_noise`, `greynoise_riot`, `greynoise_name`, `greynoise_last_seen` | ✅ community | Scanner? benign vs malicious |
| `ti.urlhaus` | `host` \| `domain` \| `ip` | `malicious`, `urlhaus_urls[]`, `urlhaus_tags[]`, `urlhaus_first_seen` | ✅ abuse.ch | Known malware-distribution host |
| `mail.dnsbl` | `ip` | `dnsbl_listed[]`, `dnsbl_count` | ✅ DNS | (also listed under Mail) |

## Ports

| block | input | output | notes |
|---|---|---|---|
| `port.scan` | `target` | `open_ports[]`, `services[]` | Native TCP connect scan (small port set) |
| `port.banner` | `target`, `port` | `port`, `banner` | Grab the service greeting (SSH/SMTP/…) |

## Parsing / transform / forensics / util

| block | input | output | notes |
|---|---|---|---|
| `map` | `json`, `pick{}` | mapped typed fields | Declarative JSON → fields via dotted paths |
| `regex` | `text`, `fields{}` | extracted fields | Recursive regex parser: group / `all` array / nested `parser` / dynamic `pairs` |
| `url.parse` | `url` | `scheme`, `host` → host, `port`, `path`, `query` | URL splitter |
| `email.parse` | `email` | `local`, `domain` → domain | Email splitter (email→CT/SPF pivot) |
| `hash.digest` | `value`, `algos[]` | `md5`, `sha1`, `sha256` | IOC hashing / correlation |
| `decode` | `value`, `encoding`, `as` | `<as>`, `decoded_as` | base64/hex/url/rot13 (auto-detect) |
| `refang` | `value`, `mode`, `as` | `refanged` \| `defanged` | Normalize/neuter IOCs (`hxxp`, `[.]`) |
| `exif` | `file` | `exif{}`, `gps`, `author`, `software`, `created`, `camera` | exiftool metadata (image/PDF/doc) |

## Flow control & escape hatches

| block | input | output | notes |
|---|---|---|---|
| `fanout` | `for_each` array | one entity per element | Explode an array field into entities |
| `filter` | `subject`/`from`, `where`/`rules` | classification / selected elements | sift-based: array-select, tag, or route (switch) |
| `log` | any (templated) | — (records input) | Debug passthrough — snapshot what flows through; view it in Executions |
| `js` | `code`, … | returned fields | Run a JS snippet (stdlib globals). **Trusted flows only** |
| `cli` | `command`, `args[]`, `as` | `<as>` (stdout), `stderr`, `exit_code` | Run any installed recon tool via execFile. **Trusted flows only** |
| `webhook` | `url`, `payload`, `headers{}` | — (side-effect) | **Outbound** POST-on-change (returns no fields = convergence-safe) |

---

## Scenarios (how blocks compose)

- **External attack-surface map:** `ct.subdomains`/`passive.*` → `dns.a` →
  `internetdb` (ports+CVEs) → `http.meta`/`http.waf`/`http.headers` →
  `http.cors`. Pivot orgs with `ip.ripestat` → `asn.prefixes`/`asn.info` and
  `ip.neighbors`.
- **Email/SPF pivot (self-feeding, no bespoke recursion):** `source.ct-log` →
  `filter` (issuer) → `dns.spf` → `regex` pulls `include:` domains (typed →
  domain) → `dns.spf` re-runs on each via convergence, so the SPF tree expands
  to a fixpoint. `ip4:`/`ip6:` extract to netblocks the same way.
- **Forensics / IOC enrichment:** `source.list` (IPs/hashes/files) →
  `ip.geo`/`rdap`/`ti.greynoise`/`ti.urlhaus`/`mail.dnsbl` + `refang`/`decode`/
  `hash.digest` + `exif` on sample files.
- **Web content discovery:** `http.wayback` + `http.sitemap` + `http.robots` +
  `http.links` + `http.forms` + `http.emails`.
- **Monitoring over time:** `bin/monitor.js` re-runs any of the above on a cron;
  persistence accumulates, the execution journal diffs, `webhook` alerts.
